import React, { useState, useEffect } from 'react';
import { AppMode, ItineraryResponse } from './types';
import { generateGroundedItinerary, analyzeComplexLogistics } from './services/geminiService';
import LiveSession from './components/LiveSession';
import ItineraryResult from './components/ItineraryResult';
import ChatBot from './components/ChatBot';

const CITIES = ["Bangkok", "Chiang Mai", "Phuket", "Krabi", "Ayutthaya"];

export default function App() {
  // Default to LIVE mode as requested
  const [mode, setMode] = useState<AppMode>(AppMode.LIVE);
  
  // Planner State
  const [destination, setDestination] = useState(CITIES[0]);
  const [interests, setInterests] = useState("");
  const [loading, setLoading] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [useComplexThinking, setUseComplexThinking] = useState(false);
  
  // Auto-generation state from Live
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  
  // Location
  const [userLocation, setUserLocation] = useState<GeolocationCoordinates | undefined>(undefined);

  // Helper for generating itinerary
  const generateItinerary = async (promptText: string) => {
      setLoading(true);
      setItinerary(null);
      try {
        if (useComplexThinking) {
            const extendedPrompt = `${promptText} Provide a deeply analyzed logistical plan considering traffic, weather patterns, and cultural timing. Explain your reasoning.`;
            const text = await analyzeComplexLogistics(extendedPrompt);
            setItinerary({ text });
        } else {
            const extendedPrompt = `${promptText} Include specific restaurant names, attraction ticket prices, and open hours using Google Maps.`;
            const result = await generateGroundedItinerary(extendedPrompt, userLocation);
            setItinerary(result);
        }
      } catch (error) {
        console.error(error);
        alert("Failed to generate itinerary. Please try again.");
      } finally {
        setLoading(false);
      }
  };

  const handleGenerate = async () => {
      // Get location for grounding if available
      if (navigator.geolocation && !userLocation) {
         navigator.geolocation.getCurrentPosition(
             (pos) => setUserLocation(pos.coords), 
             () => console.log("Loc permission denied")
         );
      }

      let prompt = `Plan a 1-day itinerary for a tourist in ${destination}. Also suggest a list of popular tourist attractions in ${destination} with brief descriptions and estimated time needed to visit.`;
      if (interests) prompt += ` Focus on these interests: ${interests}.`;
      
      await generateItinerary(prompt);
  };

  // Handle plan creation from Live Session
  const handlePlanFromLive = (transcript: string) => {
      setLiveTranscript(transcript);
      setMode(AppMode.PLANNER);
  };

  // Effect to trigger generation when transcript arrives
  useEffect(() => {
    if (liveTranscript && mode === AppMode.PLANNER) {
        // Trigger auto-generation with a tailored prompt
        const prompt = `Based on the following conversation with a tour guide, extract the user's destination preference and interests, and create a detailed 1-day itinerary.
        
        CONVERSATION TRANSCRIPT:
        ${liveTranscript}
        
        If the destination is unclear, suggest a plan for Bangkok.`;
        
        generateItinerary(prompt);
        // Clear transcript so it doesn't re-trigger
        setLiveTranscript(null);
    }
  }, [liveTranscript, mode]);


  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      
      {/* Sidebar Navigation */}
      <nav className="w-full md:w-20 lg:w-64 bg-slate-900 text-slate-300 flex md:flex-col justify-between md:justify-start shrink-0 z-50 sticky top-0">
        <div className="p-4 md:p-6 flex items-center gap-3 text-white font-bold text-xl tracking-tight">
            <div className="w-8 h-8 bg-gradient-to-tr from-amber-400 to-amber-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
                <span className="text-lg">🇹🇭</span>
            </div>
            <span className="hidden lg:block">ThaiGuide</span>
        </div>

        <div className="flex md:flex-col w-full">
            {/* 1. Live Guide */}
            <button 
                onClick={() => setMode(AppMode.LIVE)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-3 flex items-center gap-3 transition-all ${mode === AppMode.LIVE ? 'bg-slate-800 text-white border-l-4 border-rose-500' : 'hover:bg-slate-800/50'}`}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                <span className="hidden lg:block font-medium">Live Guide</span>
            </button>

            {/* 2. Trip Planner */}
            <button 
                onClick={() => setMode(AppMode.PLANNER)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-3 flex items-center gap-3 transition-all ${mode === AppMode.PLANNER ? 'bg-slate-800 text-white border-l-4 border-amber-500' : 'hover:bg-slate-800/50'}`}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.806-.984A3 3 0 0015 8m0 11V8" /></svg>
                <span className="hidden lg:block font-medium">Trip Planner</span>
            </button>
            
            {/* 3. Local Chat */}
            <button 
                onClick={() => setMode(AppMode.CHAT)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-3 flex items-center gap-3 transition-all ${mode === AppMode.CHAT ? 'bg-slate-800 text-white border-l-4 border-indigo-500' : 'hover:bg-slate-800/50'}`}
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                <span className="hidden lg:block font-medium">Local Chat</span>
            </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-[calc(100vh-80px)] md:h-screen">
        
        {mode === AppMode.PLANNER && (
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Create Your Day Plan</h1>
                    <p className="text-slate-500">Generate a custom itinerary grounded in real Google Maps data.</p>
                </header>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Destination</label>
                        <select 
                            value={destination} 
                            onChange={(e) => setDestination(e.target.value)}
                            className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        >
                            {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Interests (Optional)</label>
                        <input 
                            type="text"
                            placeholder="e.g. Street food, Temples, Shopping"
                            value={interests}
                            onChange={(e) => setInterests(e.target.value)}
                            className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                        />
                    </div>
                    <div className="md:col-span-2 flex items-center justify-between bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${useComplexThinking ? 'bg-indigo-600' : 'bg-slate-300'}`} onClick={() => setUseComplexThinking(!useComplexThinking)}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${useComplexThinking ? 'translate-x-4' : ''}`}></div>
                            </div>
                            <div>
                                <span className="block text-sm font-semibold text-slate-800">Advanced Thinking Mode</span>
                                <span className="text-xs text-slate-500">Uses Gemini 3 Pro reasoning (slower but smarter)</span>
                            </div>
                        </div>
                        <button 
                            onClick={handleGenerate}
                            disabled={loading}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-lg shadow-amber-500/30 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Generating...</span>
                                </>
                            ) : (
                                <span>Generate Plan</span>
                            )}
                        </button>
                    </div>
                </div>

                {itinerary && (
                    <div className="animate-fade-in-up">
                        <ItineraryResult 
                            content={itinerary.text} 
                            groundingChunks={itinerary.groundingChunks} 
                        />
                    </div>
                )}
            </div>
        )}

        {mode === AppMode.CHAT && (
            <div className="max-w-3xl mx-auto h-full flex flex-col justify-center">
                 <header className="mb-6 text-center">
                    <h1 className="text-2xl font-bold text-slate-900">Ask the Local Expert</h1>
                    <p className="text-slate-500">Somsri knows everything about etiquette, bargaining, and hidden gems.</p>
                </header>
                <ChatBot />
            </div>
        )}

        {mode === AppMode.LIVE && (
            <div className="max-w-md mx-auto h-full flex flex-col justify-center">
                <header className="mb-8 text-center">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Live Voice Guide</h1>
                    <p className="text-slate-500">Have a real-time voice conversation with Somsri.</p>
                </header>
                <LiveSession 
                    onClose={() => setMode(AppMode.PLANNER)} 
                    onCreatePlan={handlePlanFromLive}
                />
            </div>
        )}

      </main>
    </div>
  );
}