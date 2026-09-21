"use client";

import { coverOf } from "@/lib/media";
import type { Place } from "@/lib/types";
import MediaThumb from "./MediaThumb";

/** The Whoo-like row of saved spots that sits just above the sheet. */
export default function PlaceStrip({
  places,
  onSelect,
  hidden,
}: {
  places: Place[];
  onSelect: (place: Place) => void;
  hidden: boolean;
}) {
  return (
    <div className={`strip${hidden ? " strip-hidden" : ""}`}>
      {places.length === 0 ? (
        <p className="strip-empty">地図をタップして、行った場所を記録しよう</p>
      ) : (
        <div className="strip-scroll">
          {places.map((place) => {
            const cover = coverOf(place.media);
            return (
              <button
                type="button"
                key={place.id}
                className="strip-card"
                onClick={() => onSelect(place)}
              >
                <span className="strip-thumb">
                  {cover ? (
                    <MediaThumb media={cover} />
                  ) : (
                    <span>{place.name.trim().charAt(0).toUpperCase() || "📍"}</span>
                  )}
                </span>
                <span className="strip-name">{place.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
