
import React, { useState, useRef, useEffect } from 'react';
import { extractTextFromImage } from './geminiService';
import { PageResult, ProcessingStats } from './types';

type OutputFormat = 'txt' | 'md' | 'json';

// Extend the status to be more granular for better UX
type PageStatus = 'pending' | 'rendering' | 'processing' | 'completed' | 'error';

interface GranularPageResult extends Omit<PageResult, 'status'> {
  status: PageStatus;
  originalExtractedText?: string; // Keep track if it was edited
}

const App: React.FC = () => {
  const [pages, setPages] = useState<GranularPageResult[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('txt');
  const [stats, setStats] = useState<ProcessingStats>({
    totalPages: 0,
    processedPages: 0,
    isProcessing: false
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ensure PDF.js is loaded
  useEffect(() => {
    if (!(window as any).pdfjsLib) {
      console.error("PDF.js library failed to load from CDN.");
    }
  }, []);

  const performOcrOnPage = async (pageNumber: number, imageUrl: string) => {
    setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { ...p, status: 'processing', extractedText: '' } : p));
    
    try {
      const base64Data = imageUrl.split(',')[1];
      const text = await extractTextFromImage(base64Data);
      setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { 
        ...p, 
        extractedText: text, 
        originalExtractedText: text,
        status: 'completed' 
      } : p));
    } catch (err) {
      console.error(`OCR failed for page ${pageNumber}:`, err);
      setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { ...p, status: 'error', extractedText: '辨識過程中發生錯誤，請檢查網路連線或稍後再試。' } : p));
    }
  };

  const processPdf = async (file: File) => {
    const pdfjsLib = (window as any).pdfjsLib;
    if (!pdfjsLib) {
      alert("PDF 解析庫尚未加載完成，請稍候。");
      return;
    }

    setStats({ totalPages: 0, processedPages: 0, isProcessing: true });
    setPages([]);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
        const loadingTask = pdfjsLib.getDocument({ data: typedarray });
        const pdf = await loadingTask.promise;
        
        const total = pdf.numPages;
        setStats(prev => ({ ...prev, totalPages: total }));

        // Pre-populate pages as 'pending'
        const initialPages: GranularPageResult[] = Array.from({ length: total }, (_, i) => ({
          pageNumber: i + 1,
          imageUrl: '',
          extractedText: '',
          status: 'pending'
        }));
        setPages(initialPages);

        for (let i = 1; i <= total; i++) {
          setPages(prev => prev.map(p => p.pageNumber === i ? { ...p, status: 'rendering' } : p));
          
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) continue;
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport: viewport }).promise;
          const imageUrl = canvas.toDataURL('image/jpeg', 0.8);

          setPages(prev => prev.map(p => p.pageNumber === i ? { ...p, imageUrl, status: 'processing' } : p));
          
          await performOcrOnPage(i, imageUrl);
          setStats(prev => ({ ...prev, processedPages: i }));
        }
      } catch (err) {
        console.error("PDF Processing Error:", err);
        alert(`無法讀取 PDF 檔案: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setStats(prev => ({ ...prev, isProcessing: false }));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        alert("請選擇正確的 PDF 檔案格式。");
        return;
      }
      processPdf(file);
    }
  };

  const handleRedo = (page: GranularPageResult) => {
    if (!page.imageUrl) return;

    const isEdited = page.extractedText !== page.originalExtractedText;
    if (isEdited && page.status === 'completed') {
      const confirmed = window.confirm(`確定要重新辨識第 ${page.pageNumber} 頁嗎？這將會覆蓋您目前的修改內容。`);
      if (!confirmed) return;
    }

    performOcrOnPage(page.pageNumber, page.imageUrl);
  };

  const handleTextChange = (pageNumber: number, newText: string) => {
    setPages(prev => prev.map(p => p.pageNumber === pageNumber ? { ...p, extractedText: newText } : p));
  };

  const downloadFullText = () => {
    let content = "";
    let mimeType = "text/plain";
    let extension = "txt";

    if (selectedFormat === 'txt') {
      content = "== ZenOCR 提取結果 ==\n";
      pages.forEach(page => {
        content += `\n第 ${page.pageNumber} 頁\n`;
        content += page.status === 'completed' || page.extractedText ? page.extractedText : `[該頁辨識失敗]`;
        content += "\n--------------------\n";
      });
    } else if (selectedFormat === 'md') {
      content = "# ZenOCR 提取結果\n\n";
      pages.forEach(page => {
        content += `## 第 ${page.pageNumber} 頁\n\n`;
        content += page.status === 'completed' || page.extractedText ? page.extractedText : `*辨識失敗*`;
        content += "\n\n---\n\n";
      });
      extension = "md";
      mimeType = "text/markdown";
    } else if (selectedFormat === 'json') {
      const jsonData = pages.map(p => ({
        page: p.pageNumber,
        status: p.status,
        content: p.status === 'completed' || p.extractedText ? p.extractedText : null
      }));
      content = JSON.stringify(jsonData, null, 2);
      extension = "json";
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenocr_output.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">ZenOCR</h1>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">AI Powered Buddhist Text Extractor</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={stats.isProcessing}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold transition-all shadow-md flex items-center space-x-2 active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>上傳 PDF</span>
          </button>
          
          {pages.length > 0 && !stats.isProcessing && (
            <div className="flex items-center bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-r border-gray-300">
                <select 
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                  className="bg-transparent text-sm font-bold text-gray-700 focus:outline-none cursor-pointer"
                >
                  <option value="txt">TXT (純文字)</option>
                  <option value="md">Markdown</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <button
                onClick={downloadFullText}
                className="hover:bg-gray-50 text-indigo-600 px-5 py-2 font-bold transition-all flex items-center space-x-2"
                title="下載完整辨識內容"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span>下載全部</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="application/pdf"
        className="hidden"
      />

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-6">
        {!stats.isProcessing && pages.length === 0 ? (
          <div className="h-full min-h-[70vh] flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mb-6 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">準備開始典籍辨識</h2>
            <p className="text-gray-500 max-w-md mx-auto leading-relaxed">
              請上傳包含《現代因果報應錄》或其他精神著作的 PDF 檔案。<br/>
              系統將使用 Gemini AI 精確提取文字並保留原版結構。
            </p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-6">
            {stats.isProcessing && (
              <div className="bg-white rounded-xl p-6 shadow-md border border-indigo-100 sticky top-[88px] z-20 transition-all duration-300">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent"></div>
                    <span className="font-bold text-gray-700">正在處理文件序列...</span>
                  </div>
                  <span className="text-sm font-extrabold text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-full border border-indigo-100">
                    進度：{stats.processedPages} / {stats.totalPages} 頁
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all duration-700 ease-out shadow-[0_0_12px_rgba(79,70,229,0.4)]"
                    style={{ width: `${stats.totalPages > 0 ? (stats.processedPages / stats.totalPages) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>
            )}

            <div className="grid gap-10 pb-10">
              {pages.map((page) => (
                <div key={page.pageNumber} className={`bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col md:flex-row border transition-all duration-500 ${page.status === 'processing' ? 'border-indigo-400 ring-4 ring-indigo-50 scale-[1.01]' : 'border-gray-100'}`}>
                  {/* Left Side: Scan Image */}
                  <div className="md:w-1/2 p-6 bg-gray-50 border-r border-gray-100 flex flex-col min-h-[500px]">
                    <div className="mb-4 flex justify-between items-center">
                      <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">原始圖像 · 頁碼 {page.pageNumber}</span>
                      
                      <div className="flex items-center">
                        {page.status === 'pending' && (
                          <span className="text-[10px] font-bold text-gray-400 bg-gray-200 px-2.5 py-1 rounded-full italic">排隊中</span>
                        )}
                        {page.status === 'rendering' && (
                          <span className="flex items-center text-[10px] font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full animate-pulse border border-amber-100">
                            正在生成影印稿...
                          </span>
                        )}
                        {page.status === 'processing' && (
                          <span className="flex items-center text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full animate-pulse border border-indigo-100">
                            AI 正在深度解析...
                          </span>
                        )}
                        {page.status === 'completed' && (
                          <span className="flex items-center text-[10px] font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full shadow-sm border border-green-100">
                            辨識完成
                          </span>
                        )}
                        {page.status === 'error' && (
                          <span className="flex items-center text-[10px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                            連線異常
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex-1 flex items-center justify-center rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-sm relative group">
                      {page.imageUrl ? (
                        <img
                          src={page.imageUrl}
                          alt={`Page ${page.pageNumber}`}
                          className="w-full h-auto object-contain transition-all duration-500"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-gray-300">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-14 w-14 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">等待影像注入</span>
                        </div>
                      )}
                      {page.status === 'processing' && (
                        <div className="absolute inset-0 bg-indigo-600/5 backdrop-blur-[1px] flex items-center justify-center">
                           <div className="w-16 h-1 bg-white/30 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-600 animate-[loading_1.5s_infinite_ease-in-out]"></div>
                           </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Side: Editable Recognition Content */}
                  <div className="md:w-1/2 p-6 flex flex-col bg-white">
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center space-x-3">
                        <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">提取文本內容</span>
                        {(page.status === 'completed' || page.status === 'processing') && (
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-[9px] text-indigo-600 font-black border border-indigo-100 shadow-sm">EDITABLE</span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {(page.status === 'completed' || page.status === 'error') && page.imageUrl && (
                          <button 
                            onClick={() => handleRedo(page)}
                            className="text-[11px] text-indigo-600 hover:bg-indigo-600 hover:text-white font-bold flex items-center gap-1.5 bg-indigo-50/50 px-3 py-1.5 rounded-lg transition-all active:scale-95"
                            title="重新辨識此頁"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {page.status === 'error' ? '重試' : '重辨'}
                          </button>
                        )}
                        {page.status === 'completed' && (
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(page.extractedText);
                              alert('文字已複製到剪貼簿');
                            }}
                            className="text-[11px] text-indigo-600 hover:bg-indigo-600 hover:text-white font-bold flex items-center gap-1.5 bg-indigo-50/50 px-3 py-1.5 rounded-lg transition-all active:scale-95"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                            複製
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {page.status === 'pending' || page.status === 'rendering' ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-gray-300 space-y-3 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-400 animate-spin"></div>
                        <p className="text-[10px] uppercase tracking-widest font-black">等待隊列中</p>
                      </div>
                    ) : page.status === 'processing' ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-indigo-800 space-y-5 bg-indigo-50/30 rounded-2xl border border-indigo-100 border-dashed relative overflow-hidden">
                        <div className="relative z-10 flex flex-col items-center">
                          <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl animate-bounce mb-4">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <p className="text-sm font-black tracking-tight">Gemini 3 Pro 解析中...</p>
                          <p className="text-[10px] text-indigo-500 font-bold mt-2 uppercase tracking-tighter opacity-70">正在分析字體、標點與段落結構</p>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-indigo-100/20 to-transparent"></div>
                      </div>
                    ) : page.status === 'error' ? (
                      <div className="flex-1 flex flex-col items-center justify-center bg-red-50/50 rounded-2xl border border-red-100 p-8 text-center shadow-inner">
                        <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center text-red-600 mb-5 shadow-sm transform rotate-3">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <h3 className="text-red-900 font-black mb-2 text-lg">辨識連線出錯</h3>
                        <p className="text-red-600 text-xs mb-6 max-w-xs leading-relaxed font-medium opacity-80">{page.extractedText}</p>
                        <button
                          onClick={() => handleRedo(page)}
                          className="bg-red-600 hover:bg-red-700 text-white px-7 py-2.5 rounded-xl text-xs font-black transition-all shadow-lg active:scale-95 border-b-4 border-red-800"
                        >
                          立即重新嘗試
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col group h-full">
                        <textarea
                          value={page.extractedText}
                          onChange={(e) => handleTextChange(page.pageNumber, e.target.value)}
                          placeholder="在此處手動修改辨識結果..."
                          className="flex-1 w-full bg-white p-6 border-2 border-gray-100 rounded-2xl focus:ring-8 focus:ring-indigo-50/50 focus:border-indigo-400 outline-none font-serif text-xl leading-relaxed text-gray-800 resize-none transition-all duration-300 shadow-inner group-hover:border-gray-200"
                          style={{ minHeight: '400px' }}
                        />
                        <div className="mt-4 flex justify-between items-center text-[10px] font-black text-gray-400 italic">
                          <span className="flex items-center bg-gray-100 px-2 py-1 rounded-md">
                            最後更新：剛剛
                          </span>
                          <span className="bg-indigo-50 text-indigo-400 px-2 py-1 rounded-md">
                            修改將自動同步至導出文件
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-8 px-6 text-center text-gray-400">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-black tracking-widest uppercase">ZenOCR · 佛教典籍 AI 提取系統</p>
          <p className="text-[10px] font-bold opacity-60">POWERED BY GEMINI 3 FLASH · PDF.JS ENGINE · TAILWIND CSS</p>
        </div>
      </footer>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
};

export default App;
