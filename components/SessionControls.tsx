import React from 'react';
import { Mic, Headphones, Languages, Square, Play, MonitorSpeaker, Disc, ChevronDown, Volume2, UserCircle2 } from 'lucide-react';
import { UserRole, AudioSource, VoiceName } from '../types';
import { AudioLevelMeter } from '../App';

interface SessionControlsProps {
  role: UserRole;
  isActive: boolean;
  onToggleRole: (role: UserRole) => void;
  onToggleActive: () => void;
  targetLang: string;
  onTargetLangChange: (lang: string) => void;
  audioSource: AudioSource;
  onAudioSourceChange: (source: AudioSource) => void;
  voiceName: VoiceName;
  onVoiceNameChange: (voice: VoiceName) => void;
  audioLevel?: number;
}

const LANGUAGES = [
  { code: 'af-ZA', name: 'Afrikaans (South Africa)' },
  { code: 'sq-AL', name: 'Albanian (Albania)' },
  { code: 'am-ET', name: 'Amharic (Ethiopia)' },
  { code: 'ar-DZ', name: 'Arabic (Algeria)' },
  { code: 'ar-BH', name: 'Arabic (Bahrain)' },
  { code: 'ar-EG', name: 'Arabic (Egypt)' },
  { code: 'ar-IQ', name: 'Arabic (Iraq)' },
  { code: 'ar-JO', name: 'Arabic (Jordan)' },
  { code: 'ar-KW', name: 'Arabic (Kuwait)' },
  { code: 'ar-LB', name: 'Arabic (Lebanon)' },
  { code: 'ar-LY', name: 'Arabic (Libya)' },
  { code: 'ar-MA', name: 'Arabic (Morocco)' },
  { code: 'ar-OM', name: 'Arabic (Oman)' },
  { code: 'ar-QA', name: 'Arabic (Qatar)' },
  { code: 'ar-SA', name: 'Arabic (Saudi Arabia)' },
  { code: 'ar-PS', name: 'Arabic (State of Palestine)' },
  { code: 'ar-SY', name: 'Arabic (Syria)' },
  { code: 'ar-TN', name: 'Arabic (Tunisia)' },
  { code: 'ar-AE', name: 'Arabic (United Arab Emirates)' },
  { code: 'ar-YE', name: 'Arabic (Yemen)' },
  { code: 'hy-AM', name: 'Armenian (Armenia)' },
  { code: 'as-IN', name: 'Assamese (India)' },
  { code: 'az-AZ', name: 'Azerbaijani (Azerbaijan)' },
  { code: 'eu-ES', name: 'Basque (Spain)' },
  { code: 'bn-BD', name: 'Bengali (Bangladesh)' },
  { code: 'bn-IN', name: 'Bengali (India)' },
  { code: 'bs-BA', name: 'Bosnian (Bosnia and Herzegovina)' },
  { code: 'bg-BG', name: 'Bulgarian (Bulgaria)' },
  { code: 'my-MM', name: 'Burmese (Myanmar)' },
  { code: 'ca-ES', name: 'Catalan (Spain)' },
  { code: 'zh-CN', name: 'Chinese (Simplified, China)' },
  { code: 'zh-HK', name: 'Chinese (Traditional, Hong Kong)' },
  { code: 'zh-TW', name: 'Chinese (Traditional, Taiwan)' },
  { code: 'hr-HR', name: 'Croatian (Croatia)' },
  { code: 'cs-CZ', name: 'Czech (Czech Republic)' },
  { code: 'da-DK', name: 'Danish (Denmark)' },
  { code: 'nl-BE', name: 'Dutch (Belgium)' },
  { code: 'nl-NL', name: 'Dutch (Netherlands)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'en-GH', name: 'English (Ghana)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-IE', name: 'English (Ireland)' },
  { code: 'en-KE', name: 'English (Kenya)' },
  { code: 'en-NZ', name: 'English (New Zealand)' },
  { code: 'en-NG', name: 'English (Nigeria)' },
  { code: 'en-PH', name: 'English (Philippines)' },
  { code: 'en-SG', name: 'English (Singapore)' },
  { code: 'en-ZA', name: 'English (South Africa)' },
  { code: 'en-TZ', name: 'English (Tanzania)' },
  { code: 'en-GB', name: 'English (United Kingdom)' },
  { code: 'en-US', name: 'English (United States)' },
  { code: 'et-EE', name: 'Estonian (Estonia)' },
  { code: 'fi-FI', name: 'Finnish (Finland)' },
  { code: 'fr-BE', name: 'French (Belgium)' },
  { code: 'fr-CA', name: 'French (Canada)' },
  { code: 'fr-FR', name: 'French (France)' },
  { code: 'fr-CH', name: 'French (Switzerland)' },
  { code: 'gl-ES', name: 'Galician (Spain)' },
  { code: 'ka-GE', name: 'Georgian (Georgia)' },
  { code: 'de-AT', name: 'German (Austria)' },
  { code: 'de-DE', name: 'German (Germany)' },
  { code: 'de-CH', name: 'German (Switzerland)' },
  { code: 'el-GR', name: 'Greek (Greece)' },
  { code: 'gu-IN', name: 'Gujarati (India)' },
  { code: 'he-IL', name: 'Hebrew (Israel)' },
  { code: 'hi-IN', name: 'Hindi (India)' },
  { code: 'hu-HU', name: 'Hungarian (Hungary)' },
  { code: 'is-IS', name: 'Icelandic (Iceland)' },
  { code: 'id-ID', name: 'Indonesian (Indonesia)' },
  { code: 'it-IT', name: 'Italian (Italy)' },
  { code: 'it-CH', name: 'Italian (Switzerland)' },
  { code: 'ja-JP', name: 'Japanese (Japan)' },
  { code: 'kn-IN', name: 'Kannada (India)' },
  { code: 'kk-KZ', name: 'Kazakh (Kazakhstan)' },
  { code: 'km-KH', name: 'Khmer (Cambodia)' },
  { code: 'ko-KR', name: 'Korean (South Korea)' },
  { code: 'lo-LA', name: 'Lao (Laos)' },
  { code: 'lv-LV', name: 'Latvian (Latvia)' },
  { code: 'lt-LT', name: 'Lithuanian (Lithuania)' },
  { code: 'mk-MK', name: 'Macedonian (North Macedonia)' },
  { code: 'ms-MY', name: 'Malay (Malaysia)' },
  { code: 'ml-IN', name: 'Malayalam (India)' },
  { code: 'mr-IN', name: 'Marathi (India)' },
  { code: 'mn-MN', name: 'Mongolian (Mongolia)' },
  { code: 'ne-NP', name: 'Nepali (Nepal)' },
  { code: 'nb-NO', name: 'Norwegian Bokmål (Norway)' },
  { code: 'or-IN', name: 'Oriya (India)' },
  { code: 'fa-IR', name: 'Persian (Iran)' },
  { code: 'pl-PL', name: 'Polish (Poland)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)' },
  { code: 'pa-IN', name: 'Punjabi (India)' },
  { code: 'ro-RO', name: 'Romanian (Romania)' },
  { code: 'ru-RU', name: 'Russian (Russia)' },
  { code: 'sr-RS', name: 'Serbian (Serbia)' },
  { code: 'si-LK', name: 'Sinhala (Sri Lanka)' },
  { code: 'sk-SK', name: 'Slovak (Slovakia)' },
  { code: 'sl-SI', name: 'Slovenian (Slovenia)' },
  { code: 'es-AR', name: 'Spanish (Argentina)' },
  { code: 'es-BO', name: 'Spanish (Bolivia)' },
  { code: 'es-CL', name: 'Spanish (Chile)' },
  { code: 'es-CO', name: 'Spanish (Colombia)' },
  { code: 'es-CR', name: 'Spanish (Costa Rica)' },
  { code: 'es-DO', name: 'Spanish (Dominican Republic)' },
  { code: 'es-EC', name: 'Spanish (Ecuador)' },
  { code: 'es-SV', name: 'Spanish (El Salvador)' },
  { code: 'es-GT', name: 'Spanish (Guatemala)' },
  { code: 'es-HN', name: 'Spanish (Honduras)' },
  { code: 'es-MX', name: 'Spanish (Mexico)' },
  { code: 'es-NI', name: 'Spanish (Nicaragua)' },
  { code: 'es-PA', name: 'Spanish (Panama)' },
  { code: 'es-PY', name: 'Spanish (Paraguay)' },
  { code: 'es-PE', name: 'Spanish (Peru)' },
  { code: 'es-PR', name: 'Spanish (Puerto Rico)' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'es-US', name: 'Spanish (United States)' },
  { code: 'es-UY', name: 'Spanish (Uruguay)' },
  { code: 'es-VE', name: 'Spanish (Venezuela)' },
  { code: 'sw-KE', name: 'Swahili (Kenya)' },
  { code: 'sw-TZ', name: 'Swahili (Tanzania)' },
  { code: 'sw-TZ', name: 'Swahili (Tanzania)' },
  { code: 'sv-SE', name: 'Swedish (Sweden)' },
  { code: 'ta-IN', name: 'Tamil (India)' },
  { code: 'ta-LK', name: 'Tamil (Sri Lanka)' },
  { code: 'te-IN', name: 'Telugu (India)' },
  { code: 'th-TH', name: 'Thai (Thailand)' },
  { code: 'tr-TR', name: 'Turkish (Turkey)' },
  { code: 'uk-UA', name: 'Ukrainian (Ukraine)' },
  { code: 'ur-IN', name: 'Urdu (India)' },
  { code: 'ur-PK', name: 'Urdu (Pakistan)' },
  { code: 'uz-UZ', name: 'Uzbek (Uzbekistan)' },
  { code: 'vi-VN', name: 'Vietnamese (Vietnam)' },
  { code: 'zu-ZA', name: 'Zulu (South Africa)' }
].sort((a, b) => a.name.localeCompare(b.name));

const VOICES = [
  { id: VoiceName.PUCK, name: 'Puck', desc: 'Deep & Resonant', gender: 'M' },
  { id: VoiceName.CHARON, name: 'Charon', desc: 'Gravelly & Strong', gender: 'M' },
  { id: VoiceName.KORE, name: 'Kore', desc: 'Soft & Friendly', gender: 'F' },
  { id: VoiceName.FENRIR, name: 'Fenrir', desc: 'Bold & Direct', gender: 'M' },
  { id: VoiceName.ZEPHYR, name: 'Zephyr', desc: 'Clear & Crisp', gender: 'F' }
];

const SessionControls: React.FC<SessionControlsProps> = ({ 
  role, isActive, onToggleRole, onToggleActive, targetLang, onTargetLangChange, 
  audioSource, onAudioSourceChange, voiceName, onVoiceNameChange, audioLevel = 0
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const isSpeaker = role === UserRole.SPEAKER;
  const isListener = role === UserRole.LISTENER;

  return (
    <div className="fixed bottom-4 left-0 w-full px-4 z-50 transition-all duration-500">
      <div className="max-w-[1920px] mx-auto bg-slate-900/90 backdrop-blur-3xl border border-white/10 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl p-3 md:p-5 flex flex-col items-center gap-3 md:gap-5 overflow-hidden">
        
        {/* Toggle Expand Handle (Mobile Only) */}
        <button 
          onClick={() => setIsExpanded(!isExpanded)} 
          className="md:hidden flex-center w-full h-8 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <div className="w-10 h-1 bg-slate-700 rounded-full" />
        </button>

        <div className={`${isExpanded ? 'flex' : 'hidden md:flex'} flex-col md:flex-row items-center gap-4 md:gap-6 w-full justify-between`}>
          
          {/* Role Selection Group */}
          <div className="grid grid-cols-2 bg-slate-800/40 rounded-2xl p-1.5 border border-white/5 w-full md:w-auto">
            <ModeBtn active={isSpeaker} disabled={isActive} onClick={() => onToggleRole(UserRole.SPEAKER)} icon={Mic} label="Speak" />
            <ModeBtn active={isListener} disabled={isActive} onClick={() => onToggleRole(UserRole.LISTENER)} icon={Headphones} label="Listen" />
          </div>

          {/* Dynamic Settings Center Area */}
          <div className="flex-1 w-full md:w-auto grid place-items-center">
            <div className="flex flex-col sm:flex-row items-center gap-4 md:gap-8 w-full md:w-auto justify-center">
              
              {/* Speaker-specific Settings */}
              {isSpeaker && (
                <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-300 w-full sm:w-auto">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 text-center">Capture Source</label>
                  <div className="flex bg-slate-800/40 rounded-2xl p-1 border border-white/5">
                    <SourceBtn active={audioSource === AudioSource.MIC} disabled={isActive} onClick={() => onAudioSourceChange(AudioSource.MIC)} icon={Mic} />
                    <SourceBtn active={audioSource === AudioSource.TAB} disabled={isActive} onClick={() => onAudioSourceChange(AudioSource.TAB)} icon={MonitorSpeaker} />
                    <SourceBtn active={audioSource === AudioSource.SYSTEM} disabled={isActive} onClick={() => onAudioSourceChange(AudioSource.SYSTEM)} icon={Disc} />
                  </div>
                </div>
              )}

              {/* Listener-specific Settings */}
              {isListener && (
                <div className="flex flex-col xl:flex-row items-center gap-4 md:gap-8 w-full md:w-auto">
                  <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-300 w-full sm:w-auto">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 text-center">Translation Output</label>
                    <div className="relative group w-full min-w-[200px]">
                      <Languages className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                      <select 
                        value={targetLang}
                        onChange={(e) => onTargetLangChange(e.target.value)}
                        className="bg-slate-800/60 text-xs font-bold border border-white/5 rounded-2xl pl-11 pr-10 py-3 outline-none hover:bg-slate-700 text-slate-100 transition-all appearance-none w-full"
                      >
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                    </div>
                  </div>

                  <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-500 w-full sm:w-auto">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 text-center">Aural Presence</label>
                    <div className="flex bg-slate-800/40 rounded-2xl p-1 border border-white/5 overflow-x-auto scrollbar-hide max-w-[320px] sm:max-w-none">
                      {VOICES.map((v) => (
                        <button 
                          key={v.id}
                          onClick={() => onVoiceNameChange(v.id)}
                          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all relative group ${voiceName === v.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Volume2 className={`w-3.5 h-3.5 ${voiceName === v.id ? 'text-white' : 'text-slate-500'}`} />
                            <span className="text-[10px] font-black uppercase tracking-widest">{v.name}</span>
                          </div>
                          <span className={`text-[7px] font-bold uppercase tracking-tight opacity-60 whitespace-nowrap ${voiceName === v.id ? 'text-indigo-100' : 'text-slate-600'}`}>
                            {v.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Area */}
          <div className="flex items-center gap-4 w-full md:w-auto justify-center">
            {isActive && isSpeaker && (
              <div className="hidden lg:flex flex-col items-center gap-1.5 animate-in fade-in slide-in-from-right duration-500 px-6 border-l border-white/5">
                 <label className="text-[8px] font-black text-indigo-400 uppercase tracking-[0.3em]">Audio Feed</label>
                 <AudioLevelMeter level={audioLevel} variant="standard" />
              </div>
            )}
            
            <button
              onClick={onToggleActive}
              disabled={role === UserRole.IDLE}
              className={`flex-center gap-3 px-8 md:px-12 py-4 rounded-[1.75rem] font-black text-sm tracking-widest transition-all duration-300 shadow-xl w-full md:w-auto ${
                isActive ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-500/20' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
              } active:scale-95 disabled:opacity-20`}
            >
              {isActive ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              <span className="uppercase">{isActive ? 'Terminate' : `Initialize ${role.toLowerCase()}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ModeBtn = ({ active, disabled, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex-center gap-2 px-6 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
      active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
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
    className={`p-3 rounded-xl transition-all ${active ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50 shadow-inner scale-110' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'}`}
  >
    <Icon className="w-4.5 h-4.5" />
  </button>
);

export default SessionControls;