"use client";

import { useEffect, useRef, useState } from "react";
import { api, assetUrl } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { MAX_VIDEO_SECONDS, isVideoFile, readVideoDuration } from "@/lib/media";
import type { Media, MediaKind, Place, PlaceHint } from "@/lib/types";

export type PlaceValues = {
  name: string;
  country: string;
  countryCode: string;
  region: string;
  visitedDate: string;
  notes: string;
  media: Media[];
};

export type SheetState =
  | { mode: "create"; lat: number; lng: number }
  | { mode: "edit"; place: Place }
  | { mode: "detail"; place: Place };

function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const MAX_MEDIA = 30;

/** One album entry: already stored (`url`) or picked but not uploaded yet (`file`). */
type MediaItem = {
  key: string;
  kind: MediaKind;
  preview: string;
  url?: string;
  file?: File;
  seconds?: number | null;
};

function formatSeconds(total: number) {
  const s = Math.round(total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function MediaField({
  items,
  onPick,
  onRemove,
}: {
  items: MediaItem[];
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="field">
      <span className="field-label">アルバム</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,.mp4,.mov"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onPick(files);
          e.target.value = "";
        }}
      />
      <div className="media-grid">
        {items.map((item) => (
          <div key={item.key} className="media-tile">
            {item.kind === "video" ? (
              <video src={`${item.preview}#t=0.1`} preload="metadata" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.preview} alt="選択した写真" />
            )}
            {item.kind === "video" && (
              <span className="media-tile-badge">
                ▶ {item.seconds != null ? formatSeconds(item.seconds) : "動画"}
              </span>
            )}
            <button
              type="button"
              className="media-tile-remove"
              aria-label="削除"
              onClick={() => onRemove(item.key)}
            >
              ×
            </button>
          </div>
        ))}
        {items.length < MAX_MEDIA && (
          <button type="button" className="media-add" onClick={() => inputRef.current?.click()}>
            <span className="media-add-icon">＋</span>
            <span>追加</span>
          </button>
        )}
      </div>
      <span className="field-hint">写真は複数選べます。動画は{MAX_VIDEO_SECONDS}秒以内。</span>
    </div>
  );
}

function PlaceForm({
  initial,
  hint,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: PlaceValues;
  hint: PlaceHint | null;
  submitLabel: string;
  onSubmit: (values: PlaceValues) => Promise<void>;
  onCancel: () => void;
}) {
  // `null` means untouched, so a reverse-geocoded suggestion can still fill in.
  const [typedName, setTypedName] = useState<string | null>(initial.name || null);
  const [visitedDate, setVisitedDate] = useState(initial.visitedDate);
  const [notes, setNotes] = useState(initial.notes);
  const [items, setItems] = useState<MediaItem[]>(() =>
    initial.media.map((m, i) => ({
      key: `saved-${i}`,
      kind: m.kind,
      url: m.url,
      preview: assetUrl(m.url) ?? m.url,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Files already stored during a failed save, so a retry does not upload them twice.
  const stored = useRef(new Map<string, Media>());
  const itemsRef = useRef(items);
  const [error, setError] = useState<string | null>(null);

  const name = typedName ?? hint?.name ?? "";
  // The country is only used for stats, so it stays whatever the geocoder found.
  const country = initial.country || hint?.country || "";
  const countryCode = initial.countryCode || hint?.countryCode || "";
  const region = initial.region || hint?.region || "";

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.file) URL.revokeObjectURL(item.preview);
      }
    },
    []
  );

  async function handlePick(files: File[]) {
    setError(null);
    const problems: string[] = [];
    const added: MediaItem[] = [];
    let room = MAX_MEDIA - itemsRef.current.length;

    for (const file of files) {
      if (room <= 0) {
        problems.push(`アルバムには${MAX_MEDIA}件まで追加できます`);
        break;
      }
      const key = `new-${crypto.randomUUID()}`;
      if (isVideoFile(file)) {
        const seconds = await readVideoDuration(file);
        if (seconds !== null && seconds > MAX_VIDEO_SECONDS + 0.3) {
          problems.push(`「${file.name}」は${MAX_VIDEO_SECONDS}秒を超えています`);
          continue;
        }
        added.push({ key, kind: "video", file, seconds, preview: URL.createObjectURL(file) });
      } else if (file.type.startsWith("image/")) {
        added.push({ key, kind: "image", file, preview: URL.createObjectURL(file) });
      } else {
        problems.push(`「${file.name}」は対応していない形式です`);
        continue;
      }
      room--;
    }

    if (added.length > 0) setItems((prev) => [...prev, ...added]);
    if (problems.length > 0) setError([...new Set(problems)].join("\n"));
  }

  function handleRemove(key: string) {
    setItems((prev) => {
      const gone = prev.find((item) => item.key === key);
      if (gone?.file) URL.revokeObjectURL(gone.preview);
      return prev.filter((item) => item.key !== key);
    });
    stored.current.delete(key);
  }

  async function uploadAll(): Promise<Media[]> {
    const pending = items.filter((item) => item.file && !stored.current.has(item.key)).length;
    let done = 0;
    const media: Media[] = [];
    for (const item of items) {
      if (!item.file) {
        media.push({ url: item.url!, kind: item.kind });
        continue;
      }
      let result = stored.current.get(item.key);
      if (!result) {
        setProgress(`アップロード中 ${++done}/${pending}`);
        const body = item.kind === "image" ? await compressImage(item.file) : item.file;
        result = await api.uploadMedia(body, item.kind === "image" ? "photo.jpg" : item.file.name);
        stored.current.set(item.key, result);
      }
      media.push(result);
    }
    return media;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const media = await uploadAll();
      await onSubmit({
        name: name.trim(),
        country: country.trim(),
        countryCode,
        region,
        visitedDate,
        notes,
        media,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <form className="sheet-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">タイトル</span>
        <input
          value={name}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="京都タワー"
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span className="field-label">日付</span>
        <input type="date" value={visitedDate} onChange={(e) => setVisitedDate(e.target.value)} />
      </label>

      <MediaField items={items} onPick={handlePick} onRemove={handleRemove} />

      <label className="field">
        <span className="field-label">コメント</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="思い出をひとこと"
        />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? (progress ?? "保存中…") : submitLabel}
        </button>
      </div>
    </form>
  );
}

function DetailMedia({ media, title }: { media: Media[]; title: string }) {
  if (media.length === 0) return null;
  return (
    <>
      <div className="detail-media">
        {media.map((m) => {
          const src = assetUrl(m.url);
          if (!src) return null;
          return (
            <div key={m.url} className="detail-media-item">
              {m.kind === "video" ? (
                <video src={src} controls playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={title} />
              )}
            </div>
          );
        })}
      </div>
      {media.length > 1 && <p className="detail-media-count">{media.length}件 ・ 横にスワイプ</p>}
    </>
  );
}

function PlaceDetail({
  place,
  onEdit,
  onDelete,
}: {
  place: Place;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const date = formatDate(place.visitedDate);

  return (
    <div className="detail">
      <DetailMedia media={place.media} title={place.name} />
      <div className="detail-head">
        <h2>{place.name}</h2>
        {(place.country || date) && (
          <p className="detail-meta">
            {[place.country, date].filter(Boolean).join(" ・ ")}
          </p>
        )}
      </div>
      {place.notes && <p className="detail-notes">{place.notes}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost btn-danger" onClick={onDelete}>
          削除
        </button>
        <button type="button" className="btn btn-primary" onClick={onEdit}>
          編集
        </button>
      </div>
    </div>
  );
}

export default function PlaceSheet({
  state,
  hint,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onEdit,
}: {
  state: SheetState;
  hint: PlaceHint | null;
  onClose: () => void;
  onCreate: (values: PlaceValues) => Promise<void>;
  onUpdate: (place: Place, values: PlaceValues) => Promise<void>;
  onDelete: (place: Place) => void;
  onEdit: (place: Place) => void;
}) {
  if (state.mode === "detail") {
    return (
      <PlaceDetail
        place={state.place}
        onEdit={() => onEdit(state.place)}
        onDelete={() => onDelete(state.place)}
      />
    );
  }

  if (state.mode === "edit") {
    const { place } = state;
    return (
      <>
        <h2 className="sheet-title">この場所を編集</h2>
        <PlaceForm
          key={`edit-${place.id}`}
          initial={{
            name: place.name,
            country: place.country,
            countryCode: place.countryCode ?? "",
            region: place.region ?? "",
            visitedDate: place.visitedDate ?? "",
            notes: place.notes ?? "",
            media: place.media,
          }}
          hint={null}
          submitLabel="更新する"
          onSubmit={(values) => onUpdate(place, values)}
          onCancel={onClose}
        />
      </>
    );
  }

  return (
    <>
      <h2 className="sheet-title">この場所を記録</h2>
      <p className="sheet-coords">
        {state.lat.toFixed(4)}, {state.lng.toFixed(4)}
      </p>
      <PlaceForm
        key={`create-${state.lat.toFixed(5)},${state.lng.toFixed(5)}`}
        initial={{
          name: "",
          country: "",
          countryCode: "",
          region: "",
          visitedDate: "",
          notes: "",
          media: [],
        }}
        hint={hint}
        submitLabel="保存する"
        onSubmit={onCreate}
        onCancel={onClose}
      />
    </>
  );
}
