"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import FriendsPanel from "@/components/FriendsPanel";
import { useSheet } from "@/components/useSheet";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { compressImage } from "@/lib/image";
import type { ProfileInput, User } from "@/lib/types";
import { Loading } from "@/components/StatusView";

/** Keyed on the signed-in id, so the fields seed themselves from the saved profile. */
function ProfileForm({
  user,
  onSave,
  onCancel,
  onSaved,
  avatar,
}: {
  user: User;
  onSave: (patch: ProfileInput) => Promise<User>;
  onCancel: () => void;
  onSaved: () => void;
  avatar: React.ReactNode;
}) {
  const [name, setName] = useState(user.name);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio ?? "");
  const [rankPublic, setRankPublic] = useState(user.rankPublic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== user.name ||
    handle !== user.handle ||
    bio !== (user.bio ?? "") ||
    rankPublic !== user.rankPublic;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({ name: name.trim(), handle: handle.trim(), bio: bio.trim(), rankPublic });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2 className="card-title">プロフィールを編集</h2>
      <div className="avatar-slot">{avatar}</div>
      <label className="field">
        <span className="field-label">名前</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      </label>
      <label className="field">
        <span className="field-label">ID</span>
        <div className="handle-input">
          <span>@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
          />
        </div>
        <small className="field-note">半角英小文字・数字・_ の3〜20文字</small>
      </label>
      <label className="field">
        <span className="field-label">ひとこと</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={2}
          maxLength={140}
          placeholder="次はどこへ行こう"
        />
      </label>

      <label className="check-field">
        <input
          type="checkbox"
          checked={rankPublic}
          onChange={(e) => setRankPublic(e.target.checked)}
        />
        <span>
          世界ランキングに参加する
          <small>名前・ID・アイコンと記録の数字だけが表示されます。場所や写真は見えません。</small>
        </span>
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存する"}
        </button>
      </div>
    </form>
  );
}

function ProfileScreen() {
  const { user, loading, logout, saveProfile } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const addSheet = useSheet();

  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <Loading />;
  }

  async function pickAvatar(file: File) {
    setNote(null);
    setUploading(true);
    try {
      const url = await api.uploadImage(await compressImage(file));
      await saveProfile({ avatarUrl: url });
      setNote({ text: "アイコンを更新しました" });
    } catch (err) {
      setNote({
        text: err instanceof Error ? err.message : "アイコンを変更できませんでした",
        bad: true,
      });
    } finally {
      setUploading(false);
    }
  }

  const noteView = note && <p className={note.bad ? "form-error" : "form-status"}>{note.text}</p>;

  const avatarEditor = (
    <>
      <button
        type="button"
        className="avatar-edit"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        aria-label="アイコンを変更"
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={96} />
        <span className="avatar-edit-badge" aria-hidden>
          📷
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickAvatar(file);
          e.target.value = "";
        }}
      />
      {noteView}
    </>
  );

  return (
    <div className="page">
      <header className="page-head">
        <Link href="/" className="round-btn" aria-label="地図に戻る">
          ←
        </Link>
        <h1>プロフィール</h1>
        <button type="button" className="friend-add-btn" onClick={addSheet.show}>
          <span aria-hidden>＋</span> FRIEND
        </button>
      </header>

      <div className="page-body">
        {editing ? (
          <ProfileForm
            key={user.id}
            user={user}
            onSave={saveProfile}
            onCancel={() => {
              setNote(null);
              setEditing(false);
            }}
            onSaved={() => {
              setNote({ text: "プロフィールを保存しました" });
              setEditing(false);
            }}
            avatar={avatarEditor}
          />
        ) : (
          <section className="card card-center">
            <button
              type="button"
              className="card-edit-btn chip"
              onClick={() => {
                setNote(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <Avatar name={user.name} avatarUrl={user.avatarUrl} size={96} />
            <strong className="card-name">{user.name}</strong>
            <span className="card-handle">@{user.handle}</span>
            {user.bio && <p className="card-bio">{user.bio}</p>}
            {noteView}
          </section>
        )}

        <FriendsPanel
          sheetMounted={addSheet.mounted}
          sheetOpen={addSheet.open}
          onSheetOpen={addSheet.show}
          onSheetClose={addSheet.hide}
        />

        <Link href="/diary" className="card card-link">
          <span className="card-link-text">
            <strong>旅日記</strong>
            <small>旅の記録・ランキング</small>
          </span>
          <span className="card-link-arrow" aria-hidden>
            ›
          </span>
        </Link>

        <button type="button" className="btn btn-ghost btn-danger" onClick={() => logout()}>
          ログアウト
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ProfileScreen />
    </Suspense>
  );
}
