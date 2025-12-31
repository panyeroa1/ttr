
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
      const scrollOptions: ScrollToOptions = {
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      };
      scrollRef.current.scrollTo(scrollOptions);
    }
  }, [transcripts, translations]);

  return (
    <div className="flex flex-col h-[45vh] md:h-full min-h-[300px] bg-slate-900/40 backdrop-blur-xl rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${type === 'source' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
            {type === 'source' ? <MessageSquare className="w-3.5 h-3.5" /> : <LangIcon className="w-3.5 h-3.5" />}
          </div>
          <h3 className="font-black text-slate-300 text-[10px] uppercase tracking-widest">{title}</h3>
        </div>
        <div className={`w-1.5 h-1.5 rounded-full ${!isEmpty ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'}`} />
      </div>

      {/* Content */}
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 scrollbar-hide flex flex-col ${isEmpty ? 'justify-center items-center' : ''}`}
      >
        {isEmpty ? (
          <div className="text-center opacity-40 animate-in fade-in zoom-in duration-500">
            <div className="mb-2 p-4 bg-slate-800/50 rounded-full inline-block">
               {type === 'source' ? <MessageSquare className="w-6 h-6" /> : <LangIcon className="w-6 h-6" />}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Waiting for Stream</p>
          </div>
        ) : (
          <>
            {type === 'source' ? (
              transcripts.map((t) => (
                <div key={t.id} className={`transition-all duration-300 ${t.isFinal ? 'opacity-100' : 'opacity-70'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">{t.speaker}</span>
                    <div className="h-[1px] flex-1 bg-white/5" />
                  </div>
                  <div className="bg-slate-800/30 p-4 rounded-2xl border border-white/5 backdrop-blur-sm">
                    <p className="text-slate-100 text-sm md:text-base leading-relaxed">
                      {t.text}
                      {!t.isFinal && <span className="inline-block w-1.5 h-4 ml-2 bg-indigo-500/50 animate-pulse align-middle rounded-full" />}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              translations.map((tr) => (
                <div key={tr.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">{tr.lang}</span>
                    <div className="h-[1px] flex-1 bg-white/5" />
                  </div>
                  <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/10 backdrop-blur-sm">
                    <p className="text-emerald-50/90 text-sm md:text-base leading-relaxed font-medium">
                      {tr.text}
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
      
      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default LiveCaptions;
