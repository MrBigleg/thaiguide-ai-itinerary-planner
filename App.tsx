
import React, { useState, useEffect, useRef } from 'react';
import { AppMode, ItineraryResponse } from './types';
import { generateGroundedItinerary, analyzeComplexLogistics } from './services/geminiService';
import LiveSession from './components/LiveSession';
import ItineraryResult from './components/ItineraryResult';
import ChatBot from './components/ChatBot';

const CITIES = ["Bangkok", "Chiang Mai", "Phuket", "Krabi", "Ayutthaya"];

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.LIVE);
  
  // Planner State
  const [destination, setDestination] = useState(CITIES[0]);
  const [interests, setInterests] = useState("");
  const [loading, setLoading] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [useComplexThinking, setUseComplexThinking] = useState(false);
  
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GeolocationCoordinates | undefined>(undefined);
  
  // Map & Route State
  const mapRef = useRef<any>(null); // Ref for the gmp-map element
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; stops: number } | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  const generateItinerary = async (promptText: string) => {
      setLoading(true);
      setItinerary(null);
      setRouteInfo(null);
      if (directionsRendererRef.current) {
          directionsRendererRef.current.setMap(null);
      }

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

  const handlePlanFromLive = (transcript: string) => {
      setLiveTranscript(transcript);
      setMode(AppMode.PLANNER);
  };

  const handleSaveItinerary = () => {
      if (!itinerary) return;
      
      try {
          const savedItem = {
              id: Date.now(),
              destination,
              interests,
              text: itinerary.text,
              groundingChunks: itinerary.groundingChunks,
              created: new Date().toISOString()
          };
          
          const existingData = localStorage.getItem('thai_guide_saved_trips');
          const history = existingData ? JSON.parse(existingData) : [];
          history.unshift(savedItem);
          
          localStorage.setItem('thai_guide_saved_trips', JSON.stringify(history.slice(0, 10))); // Keep last 10
      } catch (e) {
          console.error("Failed to save to local storage", e);
      }
  };

  // Handle Map Update from Itinerary Place Selection
  const handlePlaceUpdate = (location: google.maps.LatLng) => {
      if (mapInstance) {
          mapInstance.panTo(location);
          mapInstance.setZoom(14);
      }
  };

  // Initialize Map Instance with robust cleanup
  useEffect(() => {
      let timeoutId: number;
      if (mode === AppMode.PLANNER && !mapInstance) {
         const checkMap = () => {
             if (mapRef.current && mapRef.current.innerMap) {
                 setMapInstance(mapRef.current.innerMap);
             } else if (mapRef.current) {
                 timeoutId = window.setTimeout(checkMap, 100);
             }
         };
         checkMap();
      }
      return () => {
        if (timeoutId) window.clearTimeout(timeoutId);
      };
  }, [mode, mapInstance]);

  // Plot Route when Itinerary Changes
  useEffect(() => {
      if (!itinerary || !itinerary.groundingChunks || !mapInstance) return;

      const places = itinerary.groundingChunks
          .filter(c => c.maps?.title)
          .map(c => c.maps!.title);
      
      // Deduplicate nearby sequential items to avoid tiny hops? For now keep all unique.
      const uniquePlaces = Array.from(new Set(places));

      if (uniquePlaces.length < 2) return;

      if (!directionsServiceRef.current) {
          directionsServiceRef.current = new google.maps.DirectionsService();
      }
      if (!directionsRendererRef.current) {
          directionsRendererRef.current = new google.maps.DirectionsRenderer({
              map: mapInstance,
              suppressMarkers: false, // Let Google draw A, B, C markers
          });
      } else {
          directionsRendererRef.current.setMap(mapInstance);
      }

      const origin = uniquePlaces[0];
      const destination = uniquePlaces[uniquePlaces.length - 1];
      const waypoints = uniquePlaces.slice(1, -1).map(p => ({ location: p, stopover: true }));

      directionsServiceRef.current.route({
          origin: origin,
          destination: destination,
          waypoints: waypoints,
          travelMode: google.maps.TravelMode.DRIVING, // Driving usually gives best tour connection logic
      }, (result: any, status: any) => {
          if (status === 'OK' && result) {
              directionsRendererRef.current?.setDirections(result);
              
              // Calculate totals
              let totalDist = 0;
              let totalDur = 0;
              const legs = result.routes[0].legs;
              for (let i = 0; i < legs.length; i++) {
                  totalDist += legs[i].distance?.value || 0;
                  totalDur += legs[i].duration?.value || 0;
              }

              // Format
              const distKm = (totalDist / 1000).toFixed(1);
              const durHours = Math.floor(totalDur / 3600);
              const durMins = Math.round((totalDur % 3600) / 60);
              
              setRouteInfo({
                  distance: `${distKm} km`,
                  duration: durHours > 0 ? `${durHours}h ${durMins}m` : `${durMins}m`,
                  stops: uniquePlaces.length
              });
          } else {
              console.warn("Directions request failed", status);
          }
      });

  }, [itinerary, mapInstance]);

  useEffect(() => {
    if (liveTranscript && mode === AppMode.PLANNER) {
        const prompt = `Based on the following conversation with a tour guide, extract the user's destination preference and interests, and create a detailed 1-day itinerary.
        
        CONVERSATION TRANSCRIPT:
        ${liveTranscript}
        
        If the destination is unclear, suggest a plan for Bangkok.`;
        
        generateItinerary(prompt);
        setLiveTranscript(null);
    }
  }, [liveTranscript, mode]);


  return (
    <div className="min-h-screen bg-[#F9F7F2] flex flex-col md:flex-row font-sans text-[#1e1e2e]">
      
      {/* Sidebar Navigation - Styled Thai Theme */}
      <nav className="w-full md:w-24 lg:w-64 bg-indigo-900 text-indigo-100 flex md:flex-col justify-between md:justify-start shrink-0 z-50 sticky top-0 shadow-2xl">
        <div className="p-4 md:p-6 flex items-center gap-3 text-white font-bold text-2xl tracking-tight border-b border-indigo-800/50">
            <div className="w-10 h-10 bg-gradient-to-tr from-amber-400 to-yellow-600 rounded-full flex items-center justify-center shadow-lg shadow-amber-500/30 ring-2 ring-amber-200/20">
                <span className="text-xl">🇹🇭</span>
            </div>
            <span className="hidden lg:block font-serif">ThaiGuide</span>
        </div>

        <div className="flex md:flex-col w-full pt-2">
            <button 
                onClick={() => setMode(AppMode.LIVE)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-4 flex items-center gap-4 transition-all duration-300 ${mode === AppMode.LIVE ? 'bg-indigo-800/50 text-amber-400 border-l-4 border-amber-400' : 'hover:bg-indigo-800/30 text-indigo-300'}`}
            >
                <span className="text-2xl">🎙️</span>
                <span className="hidden lg:block font-medium">Live Guide</span>
            </button>

            <button 
                onClick={() => setMode(AppMode.PLANNER)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-4 flex items-center gap-4 transition-all duration-300 ${mode === AppMode.PLANNER ? 'bg-indigo-800/50 text-amber-400 border-l-4 border-amber-400' : 'hover:bg-indigo-800/30 text-indigo-300'}`}
            >
                <span className="text-2xl">🗺️</span>
                <span className="hidden lg:block font-medium">Trip Planner</span>
            </button>
            
            <button 
                onClick={() => setMode(AppMode.CHAT)}
                className={`flex-1 md:flex-none p-4 md:px-6 md:py-4 flex items-center gap-4 transition-all duration-300 ${mode === AppMode.CHAT ? 'bg-indigo-800/50 text-amber-400 border-l-4 border-amber-400' : 'hover:bg-indigo-800/30 text-indigo-300'}`}
            >
                <span className="text-2xl">💬</span>
                <span className="hidden lg:block font-medium">Local Chat</span>
            </button>
        </div>
        
        <div className="hidden md:block mt-auto p-6 opacity-50">
             <img src="/flat-gabriel.svg" className="w-16 h-16 mx-auto mb-2 grayscale opacity-50" />
             <p className="text-xs text-center font-light text-indigo-300">Powered by Gemini 2.5</p>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative h-[calc(100vh-80px)] md:h-screen overflow-hidden">
        
        {mode === AppMode.PLANNER && (
            <div className="h-full flex flex-col">
                {/* Header */}
                <header className="p-8 pb-0">
                    <h1 className="text-4xl font-bold text-indigo-950 mb-2">Create Your Journey</h1>
                    <p className="text-slate-500 font-light">Discover Thailand with AI-powered personalized itineraries.</p>
                </header>

                {/* Split View: Inputs/Result & Map */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-8 gap-6">
                    
                    {/* Left Column: Controls & Text Results */}
                    <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 lg:max-w-2xl">
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 transition-all hover:shadow-md">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Destination</label>
                                <div className="relative">
                                    <select 
                                        value={destination} 
                                        onChange={(e) => setDestination(e.target.value)}
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none appearance-none text-lg font-medium text-indigo-900"
                                    >
                                        {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">▼</div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Interests</label>
                                <input 
                                    type="text"
                                    placeholder="e.g. Spicy food, Old temples"
                                    value={interests}
                                    onChange={(e) => setInterests(e.target.value)}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none text-lg"
                                />
                            </div>
                            
                            <div className="md:col-span-2 pt-2 flex items-center gap-4">
                                <button 
                                    onClick={handleGenerate}
                                    disabled={loading}
                                    className="flex-1 py-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold rounded-xl shadow-lg shadow-amber-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait transform hover:scale-[1.01] active:scale-[0.99]"
                                >
                                    {loading ? (
                                        <>
                                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>Somsri is Thinking...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-xl">✨</span>
                                            <span>Generate Plan</span>
                                        </>
                                    )}
                                </button>
                                
                                <button 
                                    onClick={() => setUseComplexThinking(!useComplexThinking)}
                                    className={`p-4 rounded-xl border transition-all ${useComplexThinking ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                                    title="Enable Deep Thinking Mode"
                                >
                                    🧠
                                </button>
                            </div>
                        </div>

                        {itinerary && (
                            <div className="animate-slide-up pb-10">
                                <ItineraryResult 
                                    content={itinerary.text} 
                                    groundingChunks={itinerary.groundingChunks} 
                                    onPlaceUpdate={handlePlaceUpdate}
                                    onSave={handleSaveItinerary}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right Column: Map View */}
                    <div className="hidden lg:block flex-1 bg-white rounded-3xl shadow-inner border border-slate-200 overflow-hidden relative group">
                        <gmp-map ref={mapRef} center="13.7563, 100.5018" zoom="12" map-id="DEMO_MAP_ID"></gmp-map>
                        
                        {/* Route Info Card */}
                        {routeInfo && (
                            <div className="absolute top-6 left-6 right-6 bg-white/95 backdrop-blur-xl p-4 rounded-2xl shadow-2xl border border-indigo-100 animate-fade-in z-10 flex justify-between items-center">
                                <div className="flex gap-6">
                                    <div>
                                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Distance</div>
                                        <div className="text-xl font-bold text-indigo-900">{routeInfo.distance}</div>
                                    </div>
                                    <div className="w-px bg-slate-200"></div>
                                    <div>
                                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Duration</div>
                                        <div className="text-xl font-bold text-indigo-900">{routeInfo.duration}</div>
                                    </div>
                                    <div className="w-px bg-slate-200"></div>
                                    <div>
                                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Stops</div>
                                        <div className="text-xl font-bold text-indigo-900">{routeInfo.stops}</div>
                                    </div>
                                </div>
                                <div className="text-amber-500 bg-amber-50 p-2 rounded-lg">
                                    🚗
                                </div>
                            </div>
                        )}

                        <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-lg border border-slate-100 transition-all opacity-100 group-hover:opacity-0 pointer-events-none">
                            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Map View</p>
                            <p className="text-indigo-900 font-semibold">Explore suggested locations</p>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {mode === AppMode.CHAT && (
            <div className="max-w-3xl mx-auto h-full flex flex-col justify-center p-4 md:p-8">
                 <header className="mb-6 text-center">
                    <h1 className="text-3xl font-bold text-indigo-900">Ask Somsri</h1>
                    <p className="text-slate-500 mt-2">Your personal cultural expert for etiquette, bargaining, and hidden gems.</p>
                </header>
                <ChatBot />
            </div>
        )}

        {mode === AppMode.LIVE && (
            <div className="max-w-md mx-auto h-full flex flex-col justify-center p-4">
                <header className="mb-8 text-center">
                    <h1 className="text-3xl font-bold text-indigo-900 mb-2">Live Voice Guide</h1>
                    <p className="text-slate-500">Real-time conversation with your AI companion.</p>
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
