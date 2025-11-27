import React, { useEffect, useState } from 'react';
import '../types';

interface PlaceCardProps {
  query: string;
  onPlaceSelect?: (location: google.maps.LatLng) => void;
}

const PlaceCard: React.FC<PlaceCardProps> = ({ query, onPlaceSelect }) => {
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!query) return;

    const fetchPlaceId = async () => {
      try {
        // Access Google Maps libraries
        const { PlacesService } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;
        // Use a dummy div for the service (required by legacy service, though newer ones exist)
        const service = new PlacesService(document.createElement('div'));
        
        const request = {
          query: query,
          fields: ['place_id', 'name', 'geometry'],
        };

        service.findPlaceFromQuery(request, (results: any[], status: any) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
            const pid = results[0].place_id;
            setPlaceId(pid || null);
            if (results[0].geometry?.location && onPlaceSelect) {
                onPlaceSelect(results[0].geometry.location);
            }
          } else {
            console.warn(`Place not found for: ${query}`);
            setError(true);
          }
        });
      } catch (e) {
        console.error("Maps API not loaded or error fetching place", e);
        setError(true);
      }
    };

    fetchPlaceId();
  }, [query]);

  if (error || !placeId) return null;

  return (
    <div className="my-4 animate-fade-in">
        {/* Wrapper for custom element to ensure correct rendering in React */}
        <gmp-place-details-compact>
            <gmp-place-details-place-request place={placeId}></gmp-place-details-place-request>
            {/* Customized content config for a Thai-themed cleaner look */}
            <gmp-place-content-config>
                <gmp-place-media lightbox-preferred></gmp-place-media>
                <div className="p-3">
                    <gmp-place-rating></gmp-place-rating>
                    <gmp-place-type></gmp-place-type>
                    <gmp-place-price></gmp-place-price>
                    <gmp-place-opening-hours></gmp-place-opening-hours>
                </div>
            </gmp-place-content-config>
        </gmp-place-details-compact>
    </div>
  );
};

export default PlaceCard;