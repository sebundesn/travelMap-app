"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import QrCode from "@/components/QrCode";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { compressImage } from "@/lib/image";
import type { ProfileInput, User } from "@/lib/types";
import { Loading } from "@/components/StatusView";

/** Keyed on the signed-in id, so the fields seed themselves from the saved profile. */
function ProfileForm({
  user,
  onSave,
}: {
  user: User;
  onSave: (patch: ProfileInput) => Promise<User>;
}) {
  const [name, setName] = useState(user.name);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio ?? "");
  const [rankPublic, setRankPublic] = useState(user.rankPublic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const dirty =
    name !== user.name ||
    handle !== user.handle ||
    bio !== (user.bio ?? "") ||
    rankPublic !== user.rankPublic;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      await onSave({ name: name.trim(), handle: handle.trim(), bio: bio.trim(), rankPublic });
      setStatus("プロフィールを保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2 className="card-title">プロフィール設定</h2>
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
      {status && !error && <p className="form-status">{status}</p>}

      <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
        {saving ? "保存中…" : "保存する"}
      </button>
    </form>
  );
}

export default function ProfilePage() {
  const { user, loading, logout, saveProfile } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api
      .listFriends()
      .then((f) => setFriendCount(f.length))
      .catch(() => setFriendCount(null));
    api
      .listFriendRequests()
      .then((r) => setPending(r.incoming.length))
      .catch(() => setPending(0));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) {
    return <Loading />;
  }

  const shareUrl =
    typeof window === "undefined"
      ? `@${user.handle}`
      : `${window.location.origin}/friends?add=${user.handle}`;

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

  async function copyId() {
    try {
      await navigator.clipboard.writeText(`@${user!.handle}`);
      setNote({ text: "IDをコピーしました" });
    } catch {
      setNote({ text: "コピーできませんでした", bad: true });
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <Link href="/" className="round-btn" aria-label="地図に戻る">
          ←
        </Link>
        <h1>プロフィール</h1>
        <button type="button" className="round-btn" onClick={() => logout()} aria-label="ログアウト">
          ⏻
        </button>
      </header>

      <div className="page-body">
        <section className="card card-center">
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
          <strong className="card-name">{user.name}</strong>
          <span className="card-handle">@{user.handle}</span>
          {user.bio && <p className="card-bio">{user.bio}</p>}
          {note && (
            <p className={note.bad ? "form-error" : "form-status"}>{note.text}</p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">マイQRコード</h2>
          <p className="card-note">友だちにこのコードを読み取ってもらうと申請が届きます。</p>
          <div className="qr-wrap">
            <QrCode value={shareUrl} name={user.name} avatarUrl={user.avatarUrl} />
          </div>
          <div className="id-row">
            <code>@{user.handle}</code>
            <button type="button" className="chip" onClick={copyId}>
              コピー
            </button>
          </div>
        </section>

        <Link href="/stats" className="card card-link">
          <span className="card-link-text">
            <strong>旅の記録</strong>
            <small>制覇した国・都道府県・総移動距離</small>
          </span>
          <span className="card-link-arrow" aria-hidden>
            ›
          </span>
        </Link>

        <Link href="/ranking" className="card card-link">
          <span className="card-link-text">
            <strong>ランキング</strong>
            <small>友だち・世界のなかで何位？</small>
          </span>
          <span className="card-link-arrow" aria-hidden>
            ›
          </span>
        </Link>

        <Link href="/friends" className="card card-link">
          <span className="card-link-text">
            <strong>友だち</strong>
            <small>
              {friendCount === null ? "—" : `${friendCount}人`}
              {pending > 0 && ` ・ 申請 ${pending}件`}
            </small>
          </span>
          {pending > 0 && <span className="badge">{pending}</span>}
          <span className="card-link-arrow" aria-hidden>
            ›
          </span>
        </Link>

        <ProfileForm key={user.id} user={user} onSave={saveProfile} />
      </div>
    </div>
  );
}
