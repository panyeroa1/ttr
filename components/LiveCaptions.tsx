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
  const isEmpty = type === 'source' ? transcripts.length === 0 : translations.length === 0;

  useEffect(() => {
    if (scrollRef.current) {
      // Both columns are now in descending order (newest at top)
      // Standardize scroll behavior to stay at the top to focus on new messages
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [transcripts, translations]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/40 backdrop-blur-xl rounded-[1.5rem] md:rounded-[2.5rem] border border-white/10 overflow-hidden shadow-2xl transition-all border-opacity-20">
      {/* Header */}
      <div className="px-4 md:px-10 py-4 md:py-6 border-b border-white/5 flex justify-between items-center shrink-0 bg-slate-900/20">
        <div className="flex items-center gap-3 md:gap-4">
          <div className={`p-2 md:p-3 rounded-xl md:rounded-2xl shadow-lg ${type === 'source' ? 'bg-indigo-500 text-white shadow-indigo-500/20' : 'bg-emerald-500 text-white shadow-emerald-500/20'}`}>
            {type === 'source' ? <MessageSquare className="w-4 h-4 md:w-5 md:h-5" /> : <LangIcon className="w-4 h-4 md:w-5 md:h-5" />}
          </div>
          <div>
            <h3 className="font-black text-slate-100 text-[10px] md:text-[12px] uppercase tracking-[0.2em] md:tracking-[0.25em]">{title}</h3>
            <p className="text-[8px] md:text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Real-time Stream</p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <div className={`w-2 md:w-2.5 h-2 md:h-2.5 rounded-full ${!isEmpty ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-slate-700'}`} />
          <span className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase tracking-widest">{!isEmpty ? 'Active' : 'Standby'}</span>
        </div>
      </div>

      {/* Content */}
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-3 md:p-8 lg:p-12 space-y-6 md:space-y-10 scrollbar-hide flex flex-col ${isEmpty ? 'justify-center items-center' : ''}`}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center text-center opacity-30 animate-in fade-in zoom-in duration-700">
            <div className="mb-4 md:mb-6 p-6 md:p-10 bg-slate-800/30 rounded-full inline-block border border-white/5 flex-center">
               {type === 'source' ? <MessageSquare className="w-8 h-8 md:w-12 md:h-12 text-indigo-400" /> : <LangIcon className="w-8 h-8 md:w-12 md:h-12 text-emerald-400" />}
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] md:tracking-[0.3em] text-slate-500">Awaiting Signal</p>
          </div>
        ) : (
          <>
            {type === 'source' ? (
              transcripts.map((t) => (
                <div key={t.id} className={`transition-all duration-500 w-full animate-in fade-in slide-in-from-bottom-2 ${t.isFinal ? 'opacity-100' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3 mb-2 md:mb-4">
                    <span className="text-[8px] md:text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                       <div className="w-1 h-1 bg-indigo-500 rounded-full" />
                       {t.speaker}
                    </span>
                    <div className="h-[1px] flex-1 bg-gradient-to-r from-indigo-500/20 to-transparent" />
                  </div>
                  <div className="bg-slate-800/20 p-4 md:p-8 rounded-[1.2rem] md:rounded-[2rem] border border-white/5 backdrop-blur-sm shadow-xl hover:border-indigo-500/20 transition-colors">
                    <p className="text-slate-100 text-sm md:text-lg lg:text-2xl leading-relaxed font-semibold tracking-tight">
                      {t.text}
                      {!t.isFinal && <span className="inline-block w-1.5 md:w-2.5 h-4 md:h-7 ml-2 md:ml-3 bg-indigo-500/40 animate-pulse align-middle rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)]" />}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              translations.map((tr) => (
                <div key={tr.id} className="animate-in fade-in slide-in-from-bottom-6 duration-700 w-full">
                  <div className="flex items-center gap-3 mb-2 md:mb-4">
                    <span className="text-[8px] md:text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                       <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                       {tr.lang}
                    </span>
                    <div className="h-[1px] flex-1 bg-gradient-to-r from-emerald-500/20 to-transparent" />
                  </div>
                  <div className="bg-emerald-500/5 p-4 md:p-8 rounded-[1.2rem] md:rounded-[2rem] border border-emerald-500/20 backdrop-blur-sm shadow-xl hover:border-emerald-500/40 transition-colors">
                    <p className="text-emerald-50 text-base md:text-xl lg:text-3xl leading-relaxed font-black tracking-tight drop-shadow-sm">
                      {tr.text}
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LiveCaptions;