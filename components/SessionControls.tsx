import React from 'react';
import { Mic, Headphones, Languages, Square, Play, MonitorSpeaker, Disc, ChevronUp, ChevronDown } from 'lucide-react';
import { UserRole, AudioSource } from '../types';

interface SessionControlsProps {
  role: UserRole;
  isActive: boolean;
  onToggleRole: (role: UserRole) => void;
  onToggleActive: () => void;
  targetLang: string;
  onTargetLangChange: (lang: string) => void;
  audioSource: AudioSource;
  onAudioSourceChange: (source: AudioSource) => void;
}

const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es-MX', name: 'Spanish (Mexico)' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'fr-FR', name: 'French (France)' },
  { code: 'fr-CA', name: 'French (Canada)' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'hi-IN', name: 'Hindi' },
  { code: 'ar-SA', name: 'Arabic' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'tr-TR', name: 'Turkish' },
  { code: 'nl-NL', name: 'Dutch' },
  { code: 'pl-PL', name: 'Polish' },
  { code: 'vi-VN', name: 'Vietnamese' },
  { code: 'th-TH', name: 'Thai' },
  { code: 'id-ID', name: 'Indonesian' }
];

const SessionControls: React.FC<SessionControlsProps> = ({ 
  role, isActive, onToggleRole, onToggleActive, targetLang, onTargetLangChange, audioSource, onAudioSourceChange
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-7xl px-4 z-50 transition-all duration-500">
      <div className="bg-slate-900/90 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] shadow-2xl p-4 md:p-5 flex flex-col md:flex-row items-center gap-5">
        
        <button onClick={() => setIsExpanded(!isExpanded)} className="md:hidden flex items-center justify-center w-full py-1 text-slate-500">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
        </button>

        <div className={`${isExpanded ? 'flex' : 'hidden md:flex'} flex-col md:flex-row items-center gap-5 w-full justify-between`}>
          <div className="grid grid-cols-2 bg-slate-800/40 rounded-2xl p-1.5 border border-white/5 w-full md:w-auto">
            <ModeBtn active={role === UserRole.SPEAKER} disabled={isActive} onClick={() => onToggleRole(UserRole.SPEAKER)} icon={Mic} label="Speak" />
            <ModeBtn active={role === UserRole.LISTENER} disabled={isActive} onClick={() => onToggleRole(UserRole.LISTENER)} icon={Headphones} label="Listen" />
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5 w-full md:w-auto">
            <div className={`flex flex-col w-full sm:w-auto transition-opacity ${role !== UserRole.SPEAKER ? 'opacity-20' : ''}`}>
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1.5 ml-2">Input Source</label>
              <div className="flex bg-slate-800/40 rounded-2xl p-1 border border-white/5">
                <SourceBtn active={audioSource === AudioSource.MIC} disabled={isActive || role !== UserRole.SPEAKER} onClick={() => onAudioSourceChange(AudioSource.MIC)} icon={Mic} />
                <SourceBtn active={audioSource === AudioSource.TAB} disabled={isActive || role !== UserRole.SPEAKER} onClick={() => onAudioSourceChange(AudioSource.TAB)} icon={MonitorSpeaker} />
                <SourceBtn active={audioSource === AudioSource.SYSTEM} disabled={isActive || role !== UserRole.SPEAKER} onClick={() => onAudioSourceChange(AudioSource.SYSTEM)} icon={Disc} />
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-auto">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1.5 ml-2">Translation Language</label>
              <div className="relative group">
                <Languages className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                <select 
                  value={targetLang}
                  onChange={(e) => onTargetLangChange(e.target.value)}
                  className="bg-slate-800/60 text-xs font-bold border border-white/5 rounded-2xl pl-11 pr-10 py-3 outline-none hover:bg-slate-700 transition-all appearance-none w-full md:min-w-[200px]"
                >
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onToggleActive}
          disabled={role === UserRole.IDLE}
          className={`w-full md:w-auto flex items-center justify-center gap-3 px-10 py-4 rounded-[1.75rem] font-black text-sm tracking-widest transition-all duration-300 shadow-xl ${
            isActive ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          } active:scale-95 disabled:opacity-20`}
        >
          {isActive ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          <span className="uppercase">{isActive ? 'Stop Session' : 'Start Session'}</span>
        </button>
      </div>
    </div>
  );
};

const ModeBtn = ({ active, disabled, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold transition-all ${
      active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
    } ${disabled && !active ? 'opacity-20 cursor-not-allowed' : ''}`}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </button>
);

const SourceBtn = ({ active, disabled, onClick, icon: Icon }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`p-2.5 rounded-xl transition-all ${active ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50 shadow-inner' : 'text-slate-500 hover:bg-white/5'}`}
  >
    <Icon className="w-4 h-4" />
  </button>
);

export default SessionControls;