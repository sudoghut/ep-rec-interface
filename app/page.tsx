"use client";
import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import yaml from "yaml";

type Anime = { id: number; series_name: string };
type AnimeData = Record<string, Anime[]>;

function formatYearMonth(ym: string) {
  if (!/^\d{6}$/.test(ym)) return ym;
  const year = ym.slice(0, 4);
  const month = ym.slice(4);
  return `${year}年${parseInt(month, 10)}月`;
}

export default function Home() {
  const [animeData, setAnimeData] = useState<AnimeData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Anime[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch("/api/series_with_year_month")
      .then((res) => {
        if (!res.ok) throw new Error("API 请求失败");
        return res.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAnimeData(data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Selection logic
  const isSelected = (id: number) => selected.some((a) => a.id === id);

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSelect = (anime: Anime) => {
    if (isSelected(anime.id)) {
      setSelected((prev) => prev.filter((a) => a.id !== anime.id));
    } else if (selected.length < 2) {
      setSelected((prev) => [...prev, anime]);
    }
  };

  // Show confirmation dialog when exactly 2 are selected
  useEffect(() => {
    if (selected.length === 2) {
      setShowConfirm(true);
    }
  }, [selected]);

  // --- WebSocket state and logic ---
  const [wsState, setWsState] = useState<"idle" | "connecting" | "queued" | "processing" | "done" | "error">("idle");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueElapsed, setQueueElapsed] = useState<number>(0);
  const [queueEstimate, setQueueEstimate] = useState<string>("estimating");
  const queueHistoryRef = React.useRef<{ position: number; time: number }[]>([]);
  const lastQueuePosRef = React.useRef<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = React.useRef<NodeJS.Timeout | null>(null);

  const [wsResult, setWsResult] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);

  // Keep ws and queueStartTime in refs to persist across renders
  const wsRef = React.useRef<WebSocket | null>(null);
  const queueStartTimeRef = React.useRef<number | null>(null);

  // Timer for queue elapsed time
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (wsState === "queued" && queueStartTimeRef.current) {
      timer = setInterval(() => {
        setQueueElapsed(Math.floor((Date.now() - (queueStartTimeRef.current || 0)) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [wsState]);

  // Function to handle WebSocket connection and recommendation process
  const handleWebSocketConnection = async (prompt: string, system_prompt: string) => {
    setWsState("connecting");
    setWsError(null);
    setWsResult(null);

    // // Get first 300 characters of prompt
    // prompt = prompt.slice(0, 300);

    // Fetch config.yaml
    let config: { url?: string } = {};
    try {
      const res = await fetch("/config.yaml");
      if (!res.ok) throw new Error("配置文件读取失败");
      const configText = await res.text();
      config = yaml.parse(configText);
    } catch (_e) {
      setWsError("配置文件读取失败: " + String(_e));
      setWsState("error");
      return;
    }
    const wsUrl = config.url;
    if (!wsUrl) {
      setWsError("WebSocket 配置缺失");
      setWsState("error");
      return;
    }
    // Open WebSocket
    try {
      wsRef.current = new WebSocket(wsUrl);
    } catch (_e) {
      setWsError("WebSocket 连接失败: " + String(_e));
      setWsState("error");
      return;
    }

    // Track if we've completed successfully to avoid error on close
    let hasCompleted = false;

    wsRef.current.onopen = () => {
      queueStartTimeRef.current = Date.now();
      setQueueElapsed(0);
      setQueueEstimate("estimating");
      setWsState("queued");
      wsRef.current!.send(
        JSON.stringify({
          type: "request",
          parameters: {
            prompt,
            system_prompt,
            llm: "gemini",
          },
        })
      );
    };


    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "queue_position") {
          setQueuePosition(msg.position);
          setWsState("queued");

          // Only update estimate/countdown if position decreases (new -1 event)
          if (lastQueuePosRef.current === null) {
            lastQueuePosRef.current = msg.position;
          }
          const lastQueuePos = lastQueuePosRef.current;

          if (
            typeof msg.position === "number" &&
            (queueHistoryRef.current.length === 0 || msg.position < queueHistoryRef.current[queueHistoryRef.current.length - 1].position)
          ) {
            const updated = [...queueHistoryRef.current, { position: msg.position, time: Date.now() }];
            queueHistoryRef.current = updated;

            // Estimate logic using latest queueHistoryRef
            const history = [...queueHistoryRef.current, { position: msg.position, time: Date.now() }];
            if (history.length >= 2) {
              let totalTime = 0;
              let totalPositions = 0;
              for (let i = 1; i < history.length; ++i) {
                const dt = (history[i].time - history[i - 1].time) / 1000;
                const dp = history[i - 1].position - history[i].position;
                if (dp > 0) {
                  totalTime += dt;
                  totalPositions += dp;
                }
              }
              if (totalPositions > 0) {
                const avg = totalTime / totalPositions;
                const est = Math.round(msg.position * avg);
                setCountdown(est);
                setQueueEstimate(`${est} 秒`);
              }
            } else {
              setCountdown(null);
              setQueueEstimate("estimating...");
            }
          } else if (
            typeof msg.position === "number" &&
            msg.position === lastQueuePos
          ) {
            // Do not reset countdown/estimate if position didn't decrease
            // Just keep current countdown running
          }
          lastQueuePosRef.current = msg.position;
        } else if (msg.type === "processing") {
          setWsState("processing");
        } else if (msg.type === "result" && msg.data && msg.data.Ok) {
          hasCompleted = true;
          setWsState("done");
          setWsResult(msg.data.Ok.content);
          wsRef.current?.close();
        } else if (msg.type === "ip_restricted") {
          hasCompleted = true;
          setWsError("您的IP地址已有请求在处理中，请等待完成后再试");
          setWsState("error");
          wsRef.current?.close();
        } else if (msg.type === "error" || msg.type === "queue_full") {
          hasCompleted = true;
          setWsError(msg.message || "未知错误");
          setWsState("error");
          wsRef.current?.close();
        }
    } catch (_e) {
      hasCompleted = true;
      setWsError("消息解析失败: " + String(_e));
      setWsState("error");
      wsRef.current?.close();
    }
    };

    wsRef.current.onerror = () => {
      if (!hasCompleted) {
        setWsError("WebSocket 连接错误");
        setWsState("error");
      }
    };

    wsRef.current.onclose = () => {
      if (!hasCompleted) {
        setWsError("WebSocket 连接关闭");
        setWsState("error");
      }
    };
  };

  // Countdown for estimate time
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev !== null && prev > 0) {
            if (prev === 1) {
              setQueueEstimate("estimating...");
              clearInterval(countdownRef.current!);
              countdownRef.current = null;
              return null;
            }
            return prev - 1;
          }
          return prev;
        });
      }, 1000);
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [countdown]);

  // Cleanup WebSocket when dialog is closed
  useEffect(() => {
    if (!showConfirm) {
      // Send cancel message before closing WebSocket to ensure user is removed from queue
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "cancel" }));
      }
      wsRef.current?.close();
      wsRef.current = null;
      queueStartTimeRef.current = null;
      setQueueElapsed(0);
      setQueueEstimate("estimating");
      setQueuePosition(null);
      setWsResult(null);
      setWsError(null);
      setWsState("idle");
      queueHistoryRef.current = [];
      setCountdown(null);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
  }, [showConfirm]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 sm:p-8">
      {/* Header */}
      <header className="w-full max-w-3xl mb-6 text-center">
        <h1 className="text-3xl font-bold mb-2 tracking-tight text-black">探寻</h1>
        <p className="text-gray-900 text-base sm:text-lg">
          请在当前网页中选择两部您喜欢的番，系统会基于大语言模型推荐您可能喜欢的其他番。
        </p>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-5xl flex flex-col md:flex-row gap-8 flex-1">
        {/* Anime List Section */}
        <section className="flex-1 bg-white rounded-lg shadow p-4 min-h-[300px]">
          <h2 className="text-xl font-semibold mb-4 text-black sticky top-0 bg-white z-10 py-2">番剧列表</h2>
          <div className="pt-2">
            {loading ? (
            <div className="text-gray-800 text-center py-12">加载中...</div>
          ) : error ? (
            <div className="text-red-600 text-center py-12 flex flex-col items-center gap-4">
              <span>番剧数据加载失败：{error}</span>
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  fetch("/api/series_with_year_month")
                    .then((res) => {
                      if (!res.ok) throw new Error("API 请求失败");
                      return res.json();
                    })
                    .then((data) => {
                      if (data.error) throw new Error(data.error);
                      setAnimeData(data);
                      setError(null);
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                重试
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {Object.keys(animeData)
                .sort((a, b) => b.localeCompare(a))
                .map((ym) => (
                  <div key={ym}>
                    <h3 className="text-lg font-semibold mb-2 text-black">{formatYearMonth(ym)}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {animeData[ym].map((anime) => {
                        const selectedStyle = isSelected(anime.id)
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-300"
                          : "border-transparent";
                        return (
                          <div
                            key={anime.id}
                            className={`bg-gray-100 rounded px-3 py-2 text-center cursor-pointer border transition text-black ${selectedStyle}`}
                            onClick={() => handleSelect(anime)}
                          >
                            {anime.series_name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}
          </div>
        </section>

        {/* Selected Section */}
        <aside className="w-full md:w-80 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 md:sticky md:top-8 h-[160px]">
          <h2 className="text-xl font-semibold mb-2 text-black">已选番剧</h2>
          {selected.length === 0 ? (
            <div className="text-gray-800 text-center py-2">尚未选择</div>
          ) : (
            <ul className="flex flex-col gap-3">
              {selected.map((anime) => (
                <li
                  key={anime.id}
                  className="flex items-center justify-between bg-blue-50 rounded px-3 py-2"
                >
                  <span className="text-blue-800 text-black">{anime.series_name}</span>
                  <button
                    className="ml-2 text-xs text-blue-600 hover:underline"
                    onClick={() => handleSelect(anime)}
                  >
                    取消
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>

      {/* Confirmation Dialog */}
      {showConfirm && selected.length === 2 && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-[90vw] max-w-xl">
            <div className="mb-4 text-lg font-semibold text-center text-black">
              您是否确认提交“{selected[0].series_name}”与“{selected[1].series_name}”作为喜欢的番剧用以推荐更多类似的？
            </div>
            <div className="flex flex-col gap-4 mt-6">
              <div className="flex justify-center gap-6">
                {wsState === "done" && wsResult ? (
                  // Show only close button when result is displayed
                  <button
                    className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700"
                    onClick={() => {
                      setShowConfirm(false);
                      setSelected([]);
                      setWsState("idle");
                      setWsError(null);
                      setWsResult(null);
                    }}
                  >
                    关闭
                  </button>
                ) : (
                  // Show confirm and cancel buttons when waiting for user input
                  <>
<button
  className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
  disabled={
    submitting ||
    wsState === "connecting" ||
    wsState === "queued" ||
    wsState === "processing"
  }
  onClick={async () => {
    setSubmitting(true);
    try {
      // 1. POST to API
      const res = await fetch("/api/get_content_by_series_id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_list: [selected[0].id, selected[1].id] }),
      });
      const apiData = await res.json();
      if (apiData.error) throw new Error(apiData.error);
      
      // 2. Build prompt
      const titles = Object.keys(apiData);
      const prompt =
        `These are the two acg episodes that I have submitted to you:\n` +
        `${titles[0]}: ${apiData[titles[0]].join("\n")}\n` +
        `${titles[1]}: ${apiData[titles[1]].join("\n")}\n` +
        `Base on these episodes, recommend me more acg episodes for me and give me detailed resons. Your respond will be in Chinese(中文). Please just generate the respond. Don't generate anything else, but your recommendations and reasons.`;
      const system_prompt =
        "You are an expert to recommend acg episodes for users. The user will give you two episode titles with the abstract. Please use Chinese(中文) to give me detailed recommendations and reasons. Don't generate anything else, but your recommendations and reasons.";
      
      // 3. Start WebSocket connection
      await handleWebSocketConnection(prompt, system_prompt);
    } catch (_e: unknown) {
      console.error("提交失败", _e);
      setWsError("获取推荐内容失败: " + ((_e as Error)?.message || String(_e)));
      setWsState("error");
    } finally {
      setSubmitting(false);
    }
  }}
>
  确认
</button>
<button
  className="bg-gray-200 text-gray-700 px-5 py-2 rounded hover:bg-gray-300"
  disabled={
    submitting ||
    wsState === "connecting" ||
    wsState === "queued" ||
    wsState === "processing"
  }
  onClick={() => {
    // Keep first selection, clear second
    setSelected((prev) => (prev.length > 0 ? [prev[0]] : []));
    setShowConfirm(false);
    // Reset WebSocket state when canceling
    setWsState("idle");
    setWsError(null);
    setWsResult(null);
  }}
>
  取消
</button>
                  </>
                )}
              </div>
              {/* WebSocket UI feedback */}
              {wsState === "connecting" && (
                <div className="text-blue-600 text-center">正在连接服务器...</div>
              )}
              {wsState === "queued" && (
                <div className="text-yellow-700 text-center">
                  排队中... 当前位置：{queuePosition ?? "?"}，已等待 {queueElapsed} 秒
                  <br />
                  预计剩余时间：{countdown !== null ? `${countdown} 秒` : queueEstimate}
                </div>
              )}
              {wsState === "processing" && (
                <div className="text-blue-700 text-center">正在处理您的请求...</div>
              )}
              {wsState === "done" && wsResult && (
                <div className="mt-4 p-3 bg-green-50 rounded">
                  <div className="font-semibold text-green-900 mb-2">推荐结果：</div>
                  <div className="text-gray-800 max-h-60 overflow-y-auto">
                    <ReactMarkdown>{wsResult.replace(/\\n/g, "\n")}</ReactMarkdown>
                  </div>
                </div>
              )}
              {wsState === "error" && wsError && (
                <div className="mt-4 p-3 bg-red-50 rounded text-red-700">
                  错误：{wsError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
