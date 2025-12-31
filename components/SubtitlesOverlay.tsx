import React from 'react';
import { UserCircle2 } from 'lucide-react';

interface SubtitlesOverlayProps {
  text: string;
  isFinal: boolean;
  speakerName: string;
  type: 'source' | 'target';
}

const SubtitlesOverlay: React.FC<SubtitlesOverlayProps> = ({ text, isFinal, speakerName, type }) => {
  if (!text) return null;

  return (
    <div className="fixed bottom-36 left-0 w-full px-4 md:px-12 pointer-events-none z-[45] animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="max-w-3xl mx-auto flex flex-col items-center">
        {/* Speaker Label */}
        <div className="mb-1.5 flex items-center gap-1.5 px-2 py-0.5 bg-slate-900/40 backdrop-blur-md rounded-full border border-white/5">
          <UserCircle2 className={`w-2.5 h-2.5 ${type === 'source' ? 'text-indigo-400' : 'text-emerald-400'}`} />
          <span className="text-[8px] font-black uppercase tracking-widest text-white/50">{speakerName}</span>
        </div>

        {/* Subtitle Box */}
        <div className="relative w-full text-center">
          <div className="absolute inset-0 bg-slate-950/60 blur-lg scale-105 -z-10 rounded-2xl" />
          <div className="bg-slate-950/40 backdrop-blur-xl border border-white/5 rounded-xl md:rounded-2xl p-3 md:p-4 shadow-xl">
            <p className={`text-sm md:text-base lg:text-lg font-medium leading-relaxed tracking-normal drop-shadow-md transition-all duration-200 ${
              type === 'source' ? 'text-slate-100' : 'text-emerald-50'
            } ${!isFinal ? 'opacity-80' : 'opacity-100'}`}>
              {text}
              {!isFinal && (
                <span className="inline-block ml-1.5 w-1 h-4 bg-indigo-500/40 animate-pulse rounded-full align-middle" />
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubtitlesOverlay;