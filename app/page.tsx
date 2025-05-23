"use client";
import React, { useEffect, useState } from "react";

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
          <h2 className="text-xl font-semibold mb-4 text-black">番剧列表</h2>
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
            <div className="flex flex-col gap-8">
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
        </section>

        {/* Selected Section */}
        <aside className="w-full md:w-80 bg-white rounded-lg shadow p-4 h-fit">
          <h2 className="text-xl font-semibold mb-4 text-black">已选番剧</h2>
          {selected.length === 0 ? (
            <div className="text-gray-800 text-center py-8">尚未选择</div>
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
          <div className="bg-white rounded-lg shadow-lg p-6 w-[90vw] max-w-md">
            <div className="mb-4 text-lg font-semibold text-center">
              您是否确认提交“{selected[0].series_name}”与“{selected[1].series_name}”作为喜欢的番剧用以推荐更多类似的？
            </div>
            <div className="flex justify-center gap-6 mt-6">
              <button
                className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
                disabled={submitting}
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
                      `Base on these episodes, recommend me more acg episodes for me and give me detailed resons. Your respond will be in Chinese(中文). Please just generate the respond. Don't generate anything else.`;
                    const system_prompt =
                      "You are an expert to recommend acg episodes for users. The user will give you two episode titles with the abstract. Please use Chinese(中文) to give me detailed recommendations and reasons.";
                    // 3. Print curl command and API response
                    const curl = `curl -X POST "http://localhost:{port}/api/chat" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "prompt": ${JSON.stringify(prompt)},\n    "system_prompt": ${JSON.stringify(system_prompt)},\n    "llm": "gemini",\n    "access_token": "YOUR_SERVER_ACCESS_TOKEN"\n  }'`;
                    // eslint-disable-next-line no-console
                    console.log("API Response:", apiData);
                    // eslint-disable-next-line no-console
                    console.log("Test curl command:\n", curl);
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error("提交失败", e);
                  } finally {
                    setSubmitting(false);
                    setShowConfirm(false);
                  }
                }}
              >
                确认
              </button>
              <button
                className="bg-gray-200 text-gray-700 px-5 py-2 rounded hover:bg-gray-300"
                disabled={submitting}
                onClick={() => {
                  // Keep first selection, clear second
                  setSelected((prev) => (prev.length > 0 ? [prev[0]] : []));
                  setShowConfirm(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
