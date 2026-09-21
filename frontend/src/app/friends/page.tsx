"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import BottomSheet from "@/components/BottomSheet";
import QrScanner from "@/components/QrScanner";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { Friend, FriendRequest, FriendRequests, UserLookup } from "@/lib/types";
import { Loading } from "@/components/StatusView";

const EMPTY_REQUESTS: FriendRequests = { incoming: [], outgoing: [] };

function PersonRow({
  name,
  avatarUrl,
  handle,
  note,
  children,
}: {
  name: string;
  avatarUrl?: string | null;
  handle: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="person">
      <Avatar name={name} avatarUrl={avatarUrl} size={44} />
      <span className="person-text">
        <strong>{name}</strong>
        <small>{note ? `@${handle} ・ ${note}` : `@${handle}`}</small>
      </span>
      <span className="person-actions">{children}</span>
    </div>
  );
}

function FriendsScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // A scanned or shared link lands here as ?add=handle and seeds the search box.
  const deepLink = params.get("add");

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequests>(EMPTY_REQUESTS);
  const [query, setQuery] = useState(() => deepLink ?? "");
  const [found, setFound] = useState<UserLookup | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([
        api.listFriends().catch(() => [] as Friend[]),
        api.listFriendRequests().catch(() => EMPTY_REQUESTS),
      ]).then(([list, reqs]) => {
        setFriends(list);
        setRequests(reqs);
      }),
    []
  );

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (user) void reload();
  }, [user?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(async (raw: string) => {
    const handle = raw.trim().replace(/^@/, "").toLowerCase();
    if (!handle) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setFound(await api.lookupUser(handle));
    } catch (err) {
      setFound(null);
      setError(err instanceof Error ? err.message : "検索できませんでした");
    } finally {
      setBusy(false);
    }
  }, []);

  // ...and looks that person up straight away, then drops the param from the URL.
  useEffect(() => {
    if (!user || !deepLink) return;
    api
      .lookupUser(deepLink)
      .then(setFound)
      .catch(() => setError("そのIDのユーザーは見つかりませんでした"));
    router.replace("/friends");
  }, [user?.id, deepLink, router]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) {
    return <Loading />;
  }

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await run();
      setStatus(message);
      await reload();
      if (found) setFound(await api.lookupUser(found.user.handle).catch(() => found));
    } catch (err) {
      setError(err instanceof Error ? err.message : "うまくいきませんでした");
    } finally {
      setBusy(false);
    }
  }

  function foundAction(lookup: UserLookup) {
    switch (lookup.relation) {
      case "self":
        return <span className="person-note">これはあなたです</span>;
      case "friends":
        return <span className="person-note">友だちです</span>;
      case "outgoing":
        return <span className="person-note">申請中</span>;
      case "incoming":
        return (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => act(() => api.acceptFriendRequest(lookup.requestId!), "友だちになりました")}
          >
            承認する
          </button>
        );
      default:
        return (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => act(() => api.sendFriendRequest(lookup.user.handle), "申請を送りました")}
          >
            追加する
          </button>
        );
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <Link href="/" className="round-btn" aria-label="地図に戻る">
          ←
        </Link>
        <h1>友だち</h1>
        <Link href="/profile" className="round-btn" aria-label="プロフィール">
          <Avatar name={user.name} avatarUrl={user.avatarUrl} size={36} />
        </Link>
      </header>

      <div className="page-body">
        <section className="card">
          <h2 className="card-title">IDで追加</h2>
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
          >
            <div className="handle-input">
              <span>@</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.toLowerCase())}
                placeholder="friend_id"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <button type="submit" className="btn btn-ghost btn-sm" disabled={busy || !query.trim()}>
              検索
            </button>
          </form>
          <button type="button" className="btn btn-ghost qr-open" onClick={() => setScanning(true)}>
            <span aria-hidden>📷</span> QRコードをスキャン
          </button>

          {error && <p className="form-error">{error}</p>}
          {status && !error && <p className="form-status">{status}</p>}

          {found && (
            <div className="found">
              <PersonRow
                name={found.user.name}
                avatarUrl={found.user.avatarUrl}
                handle={found.user.handle}
                note={`${found.spotCount} spots`}
              >
                {foundAction(found)}
              </PersonRow>
              {found.user.bio && <p className="card-bio">{found.user.bio}</p>}
            </div>
          )}
        </section>

        {requests.incoming.length > 0 && (
          <section className="card">
            <h2 className="card-title">届いている申請</h2>
            {requests.incoming.map((req: FriendRequest) => (
              <PersonRow
                key={req.id}
                name={req.user.name}
                avatarUrl={req.user.avatarUrl}
                handle={req.user.handle}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => act(() => api.dismissFriendRequest(req.id), "申請を削除しました")}
                >
                  削除
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => act(() => api.acceptFriendRequest(req.id), "友だちになりました")}
                >
                  承認
                </button>
              </PersonRow>
            ))}
          </section>
        )}

        {requests.outgoing.length > 0 && (
          <section className="card">
            <h2 className="card-title">送った申請</h2>
            {requests.outgoing.map((req: FriendRequest) => (
              <PersonRow
                key={req.id}
                name={req.user.name}
                avatarUrl={req.user.avatarUrl}
                handle={req.user.handle}
                note="承認待ち"
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => act(() => api.dismissFriendRequest(req.id), "申請を取り消しました")}
                >
                  取り消す
                </button>
              </PersonRow>
            ))}
          </section>
        )}

        <section className="card">
          <h2 className="card-title">友だち {friends.length > 0 && `(${friends.length})`}</h2>
          {friends.length === 0 ? (
            <p className="card-note">
              まだ友だちがいません。IDやQRコードで追加すると、相手の行った場所が地図に並びます。
            </p>
          ) : (
            friends.map((friend) => (
              <PersonRow
                key={friend.id}
                name={friend.name}
                avatarUrl={friend.avatarUrl}
                handle={friend.handle}
                note={`${friend.spotCount} spots`}
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`${friend.name}さんを友だちから削除しますか？`)) return;
                    act(() => api.removeFriend(friend.id), "友だちを削除しました");
                  }}
                >
                  削除
                </button>
              </PersonRow>
            ))
          )}
        </section>
      </div>

      {scanning && (
        <BottomSheet open={scanning} onClose={() => setScanning(false)}>
          <QrScanner
            onClose={() => setScanning(false)}
            onScan={(handle) => {
              setScanning(false);
              setQuery(handle);
              search(handle);
            }}
          />
        </BottomSheet>
      )}
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FriendsScreen />
    </Suspense>
  );
}
