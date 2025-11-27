import React from 'react';

export enum AppMode {
  PLANNER = 'PLANNER',
  CHAT = 'CHAT',
  LIVE = 'LIVE',
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
    placeAnswerSources?: {
        reviewSnippets?: {
            content: string;
        }[]
    }
  };
}

export interface ItineraryResponse {
  text: string;
  groundingChunks?: GroundingChunk[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export interface LiveConnectionState {
  isConnected: boolean;
  isSpeaking: boolean;
  error: string | null;
}

// Declare Google Maps UI Kit Custom Elements and Google Maps Types
declare global {
  // Define google namespace for types (e.g. google.maps.LatLng)
  namespace google {
    namespace maps {
      class Map {
        constructor(mapDiv: Element | null, opts?: any);
        panTo(latLng: any): void;
        setZoom(zoom: number): void;
      }
      class LatLng {
        constructor(lat: number, lng: number);
      }
      class PlacesLibrary {}
      namespace places {
        class PlacesService {
            constructor(attr: any);
            findPlaceFromQuery(req: any, cb: any): void;
        }
        enum PlacesServiceStatus {
            OK = 'OK'
        }
      }
      class DirectionsService {
        route(request: any, callback: (result: any, status: any) => void): void;
      }
      class DirectionsRenderer {
        constructor(opts?: any);
        setMap(map: any): void;
        setDirections(result: any): void;
      }
      enum TravelMode {
        DRIVING = 'DRIVING',
        WALKING = 'WALKING',
        BICYCLING = 'BICYCLING',
        TRANSIT = 'TRANSIT'
      }
      enum DirectionsStatus {
        OK = 'OK'
      }
    }
  }

  // Define google var for runtime access
  var google: any;

  interface Window {
    google: any;
  }

  namespace JSX {
    interface IntrinsicElements {
      'gmp-map': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        center?: string;
        zoom?: string;
        'map-id'?: string;
      };
      'gmp-advanced-marker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        position?: string;
        title?: string;
      };
      'gmp-place-details': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-details-compact': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-details-place-request': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        place?: string; // Place ID or resource name
      };
      'gmp-place-all-content': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-content-config': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-media': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'lightbox-preferred'?: boolean;
      };
      'gmp-place-rating': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-type': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-price': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-opening-hours': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'gmp-place-photo-gallery': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}