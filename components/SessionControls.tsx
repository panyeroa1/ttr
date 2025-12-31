
import React from 'react';
import { Mic, Headphones, Languages, Square, Play, MonitorSpeaker, Disc } from 'lucide-react';
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
  // --- ENGLISH DIALECTS ---
  { code: 'en-US', name: 'English (United States)' },
  { code: 'en-GB', name: 'English (United Kingdom)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-IE', name: 'English (Ireland)' },
  { code: 'en-NZ', name: 'English (New Zealand)' },
  { code: 'en-ZA', name: 'English (South Africa)' },
  { code: 'en-NG', name: 'English (Nigeria)' },
  { code: 'en-PH', name: 'English (Philippines)' },
  { code: 'en-SG', name: 'English (Singapore)' },
  
  // --- SPANISH DIALECTS ---
  { code: 'es-MX', name: 'Spanish (Mexico)' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'es-AR', name: 'Spanish (Argentina)' },
  { code: 'es-CO', name: 'Spanish (Colombia)' },
  { code: 'es-CL', name: 'Spanish (Chile)' },
  { code: 'es-PE', name: 'Spanish (Peru)' },
  { code: 'es-VE', name: 'Spanish (Venezuela)' },
  { code: 'es-PR', name: 'Spanish (Puerto Rico)' },
  { code: 'es-US', name: 'Spanish (United States)' },
  { code: 'es-DO', name: 'Spanish (Dominican Republic)' },
  { code: 'es-EC', name: 'Spanish (Ecuador)' },
  { code: 'es-GT', name: 'Spanish (Guatemala)' },
  
  // --- FRENCH DIALECTS ---
  { code: 'fr-FR', name: 'French (France)' },
  { code: 'fr-CA', name: 'French (Canada)' },
  { code: 'fr-BE', name: 'French (Belgium)' },
  { code: 'fr-CH', name: 'French (Switzerland)' },
  { code: 'fr-MA', name: 'French (Morocco)' },
  { code: 'fr-SN', name: 'French (Senegal)' },
  
  // --- PORTUGUESE DIALECTS ---
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)' },
  { code: 'pt-AO', name: 'Portuguese (Angola)' },
  
  // --- CHINESE DIALECTS ---
  { code: 'zh-CN', name: 'Chinese (Mandarin, Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Mandarin, Traditional)' },
  { code: 'zh-HK', name: 'Chinese (Cantonese, Hong Kong)' },
  { code: 'zh-MO', name: 'Chinese (Cantonese, Macau)' },
  { code: 'nan-TW', name: 'Chinese (Hokkien / Taiwanese)' },
  { code: 'hak-CN', name: 'Chinese (Hakka)' },
  
  // --- ARABIC DIALECTS ---
  { code: 'ar-SA', name: 'Arabic (Saudi Arabia)' },
  { code: 'ar-EG', name: 'Arabic (Egypt)' },
  { code: 'ar-AE', name: 'Arabic (UAE)' },
  { code: 'ar-MA', name: 'Arabic (Morocco)' },
  { code: 'ar-DZ', name: 'Arabic (Algeria)' },
  { code: 'ar-IQ', name: 'Arabic (Iraq)' },
  { code: 'ar-JO', name: 'Arabic (Jordan)' },
  { code: 'ar-KW', name: 'Arabic (Kuwait)' },
  { code: 'ar-LB', name: 'Arabic (Lebanon)' },
  { code: 'ar-QA', name: 'Arabic (Qatar)' },
  
  // --- OTHER EUROPEAN ---
  { code: 'de-DE', name: 'German (Germany)' },
  { code: 'de-AT', name: 'German (Austria)' },
  { code: 'de-CH', name: 'German (Switzerland)' },
  { code: 'gsw-CH', name: 'German (Swiss German)' },
  { code: 'bar-DE', name: 'German (Bavarian)' },
  { code: 'it-IT', name: 'Italian (Italy)' },
  { code: 'it-CH', name: 'Italian (Switzerland)' },
  { code: 'nap-IT', name: 'Italian (Neapolitan)' },
  { code: 'scn-IT', name: 'Italian (Sicilian)' },
  { code: 'nl-NL', name: 'Dutch (Netherlands)' },
  { code: 'nl-BE', name: 'Dutch (Belgium)' },
  { code: 'vls-BE', name: 'Dutch (West Flemish)' },
  { code: 'ru-RU', name: 'Russian (Russia)' },
  { code: 'pl-PL', name: 'Polish' },
  { code: 'uk-UA', name: 'Ukrainian' },
  { code: 'tr-TR', name: 'Turkish' },
  { code: 'el-GR', name: 'Greek' },
  { code: 'sv-SE', name: 'Swedish' },
  { code: 'no-NO', name: 'Norwegian' },
  { code: 'da-DK', name: 'Danish' },
  { code: 'fi-FI', name: 'Finnish' },
  { code: 'cs-CZ', name: 'Czech' },
  { code: 'hu-HU', name: 'Hungarian' },
  { code: 'ro-RO', name: 'Romanian' },
  { code: 'ca-ES', name: 'Catalan' },
  { code: 'eu-ES', name: 'Basque' },
  { code: 'gl-ES', name: 'Galician' },
  
  // --- ASIAN & PACIFIC ---
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'vi-VN', name: 'Vietnamese' },
  { code: 'th-TH', name: 'Thai' },
  { code: 'id-ID', name: 'Indonesian' },
  { code: 'ms-MY', name: 'Malay' },
  { code: 'tl-PH', name: 'Tagalog (Philippines)' },
  { code: 'ilo-PH', name: 'Ilocano (Philippines)' },
  { code: 'ceb-PH', name: 'Cebuano (Philippines)' },
  { code: 'hil-PH', name: 'Hiligaynon (Philippines)' },
  { code: 'war-PH', name: 'Waray-Waray (Philippines)' },
  { code: 'km-KH', name: 'Khmer (Cambodia)' },
  { code: 'lo-LA', name: 'Lao' },
  { code: 'my-MM', name: 'Burmese' },
  
  // --- SOUTH ASIAN ---
  { code: 'hi-IN', name: 'Hindi (India)' },
  { code: 'bn-IN', name: 'Bengali (India)' },
  { code: 'bn-BD', name: 'Bengali (Bangladesh)' },
  { code: 'te-IN', name: 'Telugu' },
  { code: 'mr-IN', name: 'Marathi' },
  { code: 'ta-IN', name: 'Tamil (India)' },
  { code: 'ta-LK', name: 'Tamil (Sri Lanka)' },
  { code: 'ur-PK', name: 'Urdu (Pakistan)' },
  { code: 'ur-IN', name: 'Urdu (India)' },
  { code: 'gu-IN', name: 'Gujarati' },
  { code: 'kn-IN', name: 'Kannada' },
  { code: 'ml-IN', name: 'Malayalam' },
  { code: 'pa-IN', name: 'Punjabi (India)' },
  { code: 'pa-PK', name: 'Punjabi (Pakistan)' },
  { code: 'si-LK', name: 'Sinhala' },
  { code: 'ne-NP', name: 'Nepali' },
  
  // --- MIDDLE EAST & AFRICAN ---
  { code: 'he-IL', name: 'Hebrew' },
  { code: 'fa-IR', name: 'Persian (Farsi)' },
  { code: 'sw-KE', name: 'Swahili (Kenya)' },
  { code: 'sw-TZ', name: 'Swahili (Tanzania)' },
  { code: 'am-ET', name: 'Amharic' },
  { code: 'yo-NG', name: 'Yoruba' },
  { code: 'ig-NG', name: 'Igbo' },
  { code: 'ha-NE', name: 'Hausa' },
  { code: 'zu-ZA', name: 'Zulu' },
  { code: 'xh-ZA', name: 'Xhosa' },
  { code: 'af-ZA', name: 'Afrikaans' }
];

const SessionControls: React.FC<SessionControlsProps> = ({ 
  role, 
  isActive, 
  onToggleRole, 
  onToggleActive,
  targetLang,
  onTargetLangChange,
  audioSource,
  onAudioSourceChange
}) => {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center w-full max-w-7xl px-4 z-50">
      <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 p-4 rounded-3xl shadow-2xl flex items-center gap-4 w-full justify-between overflow-x-auto scrollbar-hide">
        
        {/* Mode Selector */}
        <div className="flex bg-slate-800/80 rounded-2xl p-1.5 border border-slate-700 shrink-0 shadow-inner">
          <button
            onClick={() => onToggleRole(UserRole.SPEAKER)}
            disabled={isActive}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
              role === UserRole.SPEAKER 
                ? 'bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-400/50' 
                : 'text-slate-400 hover:text-slate-200'
            } ${isActive && role !== UserRole.SPEAKER ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Mic className="w-4 h-4" />
            <span>Speak</span>
          </button>
          <button
            onClick={() => onToggleRole(UserRole.LISTENER)}
            disabled={isActive}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
              role === UserRole.LISTENER 
                ? 'bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-400/50' 
                : 'text-slate-400 hover:text-slate-200'
            } ${isActive && role !== UserRole.LISTENER ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Headphones className="w-4 h-4" />
            <span>Listen</span>
          </button>
        </div>

        {/* Audio Source Selector - Permanently visible and enhanced */}
        <div className={`flex items-center gap-3 shrink-0 border-l border-slate-800 pl-6 ml-2 transition-all duration-500 ${role !== UserRole.SPEAKER ? 'opacity-30 grayscale pointer-events-none' : 'opacity-100'}`}>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Input Source</span>
            <div className="flex bg-slate-800/80 rounded-2xl p-1.5 border border-slate-700 shadow-inner">
              <button
                onClick={() => onAudioSourceChange(AudioSource.MIC)}
                disabled={isActive}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all duration-300 ${
                  audioSource === AudioSource.MIC 
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-300'
                } ${isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Microphone"
              >
                <Mic className="w-4 h-4" />
                <span className="hidden xl:inline">Microphone</span>
                <span className="xl:hidden">Mic</span>
              </button>
              <button
                onClick={() => onAudioSourceChange(AudioSource.TAB)}
                disabled={isActive}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all duration-300 ${
                  audioSource === AudioSource.TAB 
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-300'
                } ${isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Browser Tab Audio"
              >
                <MonitorSpeaker className="w-4 h-4" />
                <span className="hidden xl:inline">Browser Tab</span>
                <span className="xl:hidden">Tab</span>
              </button>
              <button
                onClick={() => onAudioSourceChange(AudioSource.SYSTEM)}
                disabled={isActive}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all duration-300 ${
                  audioSource === AudioSource.SYSTEM 
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-300'
                } ${isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="System/Internal Audio"
              >
                <Disc className="w-4 h-4" />
                <span className="hidden xl:inline">System Audio</span>
                <span className="xl:hidden">Sys</span>
              </button>
            </div>
          </div>
        </div>

        {/* Language Selection */}
        <div className="flex items-center gap-4 shrink-0 border-l border-slate-800 pl-6">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Target Dialect</span>
            <div className="relative group">
              <Languages className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 pointer-events-none group-focus-within:text-indigo-300" />
              <select 
                value={targetLang}
                onChange={(e) => onTargetLangChange(e.target.value)}
                className="bg-slate-800/80 text-slate-200 text-xs font-bold border border-slate-700 rounded-2xl pl-10 pr-10 py-3 outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer appearance-none min-w-[220px] shadow-inner hover:bg-slate-700/80 transition-colors"
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <div className="border-t-2 border-r-2 border-slate-500 w-1.5 h-1.5 rotate-[135deg]" />
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onToggleActive}
          className={`flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-black text-sm tracking-wider transition-all duration-300 shrink-0 ml-auto shadow-2xl ${
            isActive 
              ? 'bg-rose-600 hover:bg-rose-500 text-white hover:scale-105 active:scale-95 ring-4 ring-rose-500/20' 
              : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-105 active:scale-95 ring-4 ring-indigo-500/20'
          }`}
        >
          {isActive ? (
            <>
              <Square className="w-4 h-4 fill-current" />
              <span>STOP SESSION</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>START BROADCAST</span>
            </>
          )}
        </button>
      </div>
      
      {/* Dynamic Status Overlay */}
      {isActive && (
        <div className="flex items-center gap-3 bg-slate-900/80 px-6 py-2 rounded-full border border-indigo-500/30 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-2xl">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
          </div>
          <span className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em]">
            {role === UserRole.SPEAKER 
              ? `LIVE STREAMING: ${audioSource === AudioSource.MIC ? 'Microphone' : audioSource === AudioSource.TAB ? 'Tab Content' : 'System Audio'}`
              : `SYNCED: TRANSLATING TO ${LANGUAGES.find(l => l.code === targetLang)?.name.toUpperCase()}`
            }
          </span>
        </div>
      )}
    </div>
  );
};

export default SessionControls;
