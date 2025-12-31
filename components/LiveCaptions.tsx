
import React, { useEffect, useRef } from 'react';
import { TranscriptionItem, TranslationItem } from '../types';
import { MessageSquare, Languages as LangIcon } from 'lucide-react';

interface LiveCaptionsProps {
  transcripts: TranscriptionItem[];
  translations: TranslationItem[];
  title: string;
  type: 'source' | 'target';
}

const LiveCaptions: React.FC<LiveCaptionsProps> = ({ transcripts, translations, title, type }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, translations]);

  const isEmpty = type === 'source' ? transcripts.length === 0 : translations.length === 0;

  return (
    <div className="flex flex-col h-full bg-slate-900/40 backdrop-blur-xl rounded-[2rem] border border-slate-800/50 overflow-hidden shadow-2xl transition-all duration-500 hover:border-slate-700/50">
      {/* Container Header */}
      <div className="px-8 py-5 border-b border-slate-800/50 flex justify-between items-center bg-slate-900/20">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${type === 'source' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
            {type === 'source' ? <MessageSquare className="w-4 h-4" /> : <LangIcon className="w-4 h-4" />}
          </div>
          <h3 className="font-black text-slate-200 text-xs uppercase tracking-[0.2em]">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
           <div className={`w-1.5 h-1.5 rounded-full ${!isEmpty ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
           <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
            {!isEmpty ? 'ACTIVE' : 'IDLE'}
           </span>
        </div>
      </div>

      {/* Scrollable Content Container */}
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth custom-scrollbar flex flex-col ${isEmpty ? 'justify-center items-center' : ''}`}
      >
        {type === 'source' ? (
          transcripts.length === 0 ? (
            <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in duration-700">
              <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 shadow-inner">
                <MessageSquare className="w-8 h-8 text-slate-600" />
              </div>
              <div>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Waiting for Audio</p>
                <p className="text-slate-600 text-[10px] mt-1 uppercase tracking-[0.2em]">Start broadcast to begin transcription</p>
              </div>
            </div>
          ) : (
            transcripts.map((t) => (
              <div key={t.id} className={`transition-all duration-500 transform ${t.isFinal ? 'opacity-100 scale-100' : 'opacity-60 scale-[0.98]'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.2em]">{t.speaker}</span>
                  <div className="h-[1px] flex-1 bg-indigo-500/10" />
                </div>
                <div className="relative">
                  <p className="text-slate-200 text-lg leading-relaxed bg-slate-800/40 p-5 rounded-2xl border border-slate-700/30 shadow-sm backdrop-blur-sm">
                    {t.text}
                    {!t.isFinal && <span className="inline-block w-2 h-5 ml-2 bg-indigo-500 animate-pulse align-middle rounded-sm" />}
                  </p>
                </div>
              </div>
            ))
          )
        ) : (
          translations.length === 0 ? (
            <div className="flex flex-col items-center gap-4 text-center animate-in fade-in zoom-in duration-700">
              <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 shadow-inner">
                <LangIcon className="w-8 h-8 text-slate-600" />
              </div>
              <div>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Synthesizing</p>
                <p className="text-slate-600 text-[10px] mt-1 uppercase tracking-[0.2em]">Translation stream will appear here</p>
              </div>
            </div>
          ) : (
            translations.map((tr) => (
              <div key={tr.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em]">{tr.lang}</span>
                  <div className="h-[1px] flex-1 bg-emerald-500/10" />
                </div>
                <div className="relative">
                  <p className="text-emerald-50/90 text-lg leading-relaxed bg-emerald-500/5 p-5 rounded-2xl border border-emerald-500/20 shadow-lg shadow-emerald-900/10 backdrop-blur-sm">
                    {tr.text}
                  </p>
                  <div className="absolute top-0 right-0 -mt-1 -mr-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500/50 blur-[2px]" />
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(71, 85, 105, 0.4);
        }
      `}</style>
    </div>
  );
};

export default LiveCaptions;
