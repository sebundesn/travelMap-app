# AWS 手順書 — travelMap をポートフォリオ向けネットワーク構成でデプロイする

対象読者: このリポジトリの travelMap を、就活ポートフォリオとして「AWSでVPCを設計・構築した」と語れる形でAWS上に公開したい人。
前提: AWS無料枠中心、リージョンは **ap-northeast-1（東京）** に統一。CI/CDは別ドキュメントで扱うので、ここではコンソール操作中心に「手で動かして理解する」ことを優先する。

> 各セクションの先頭に `[ ]` チェックリストを付けている。実施したら `[x]` にしながら進めるとよい（このファイル自体をリポジトリにコミットして進捗を残せる）。

---

## 0. 全体像

```
                         Internet
                            │
┌───────────────────────────┼──────────────────────────────────────────┐
│  main-vpc  10.0.0.0/16                                                │
│                                                                        │
│  public-a 10.0.0.0/24 (1a)      public-c 10.0.1.0/24 (1c)             │
│   └─ ALB, NAT Instance           └─ ALB（冗長化用）                    │
│  ────────────────────────── IGW ─────────────────────────             │
│  private-app-a 10.0.10.0/24 (1a)                                      │
│   └─ App EC2: backend+frontend（Docker） / SSM経由でアクセス          │
│  private-db-a 10.0.20.0/24 (1a)  private-db-c 10.0.21.0/24 (1c)       │
│   └─ RDS PostgreSQL（DB Subnet Groupは2AZ必須）                       │
│                              │ VPC Peering                            │
└──────────────────────────────┼─────────────────────────────────────────┘
                                │
┌──────────────────────────────┼─────────────────────────────────────────┐
│  mgmt-vpc  10.1.0.0/16        │                                        │
│  public 10.1.0.0/24 (1a)      │                                        │
│   └─ WireGuard VPN Gateway EC2 ─┘  ← 自宅PCからVPN接続して private網へ │
└─────────────────────────────────────────────────────────────────────┘
```

**リソース命名規則**（コンソールでタグ付けする際に統一する）:

| 種別 | 名前 |
|---|---|
| VPC | `travelmap-main-vpc`, `travelmap-mgmt-vpc` |
| サブネット | `travelmap-public-a`, `travelmap-public-c`, `travelmap-private-app-a`, `travelmap-private-db-a`, `travelmap-private-db-c`, `travelmap-mgmt-public-a` |
| EC2 | `travelmap-app`, `travelmap-nat`, `travelmap-wireguard` |
| SG | `travelmap-sg-alb`, `travelmap-sg-app`, `travelmap-sg-nat`, `travelmap-sg-rds`, `travelmap-sg-wireguard` |
| RDS | `travelmap-db` |
| ALB | `travelmap-alb` |

---

## Part 1. 事前準備

- [ ] AWSアカウント作成（既にある場合はスキップ）
- [ ] **ルートユーザーにMFAを設定**（Eメール・パスワードのみは危険）
- [ ] IAM Identity Center もしくは IAM ユーザーで管理者権限のユーザーを作成し、以後はそれを使う（ルートユーザーで作業しない）
- [ ] **Billing → Budgets** で予算アラートを作成（例: 月$5を超えたらメール通知）。無料枠中心の構成でも設定ミスで課金が走ることがあるので、これは必須
- [ ] `aws configure` でAWS CLIをセットアップ（コンソール操作の合間にCLIも使う）
- [ ] IAMユーザーにMFAも設定

```bash
aws configure
# AWS Access Key ID, Secret, region=ap-northeast-1, output=json
aws sts get-caller-identity   # 動作確認
```

---

## Part 2. main-vpc とサブネット

### 2-1. VPC作成

VPCコンソール → **VPCを作成** → 「VPCのみ」

| 項目 | 値 |
|---|---|
| 名前タグ | `travelmap-main-vpc` |
| IPv4 CIDR | `10.0.0.0/16` |

- [ ] `travelmap-main-vpc` 作成

### 2-2. サブネット作成

VPCコンソール → **サブネット → サブネットを作成** → 対象VPCに `travelmap-main-vpc` を選択し、以下を一括作成:

| 名前 | AZ | CIDR | 用途 |
|---|---|---|---|
| `travelmap-public-a` | ap-northeast-1a | 10.0.0.0/24 | ALB, NAT |
| `travelmap-public-c` | ap-northeast-1c | 10.0.1.0/24 | ALB冗長化 |
| `travelmap-private-app-a` | ap-northeast-1a | 10.0.10.0/24 | App EC2 |
| `travelmap-private-db-a` | ap-northeast-1a | 10.0.20.0/24 | RDS |
| `travelmap-private-db-c` | ap-northeast-1c | 10.0.21.0/24 | RDS（Subnet Groupは2AZ必須） |

- [ ] 5サブネット作成完了

### 2-3. インターネットゲートウェイ

VPCコンソール → **インターネットゲートウェイ → 作成** → 名前 `travelmap-igw` → 作成後、**VPCにアタッチ** で `travelmap-main-vpc` を選択。

- [ ] IGW作成・アタッチ

### 2-4. ルートテーブル

**public用ルートテーブル**（`travelmap-rt-public`）:
- ルート: `0.0.0.0/0 → travelmap-igw`
- サブネット関連付け: `public-a`, `public-c`

**private-app用ルートテーブル**（`travelmap-rt-private-app`）:
- ルート: `0.0.0.0/0 → NATインスタンス`（Part 4で作成後に設定。今は空のままでOK）
- サブネット関連付け: `private-app-a`

**private-db用ルートテーブル**（`travelmap-rt-private-db`）:
- ルートはローカルのみ（インターネット不要）
- サブネット関連付け: `private-db-a`, `private-db-c`

- [ ] 3つのルートテーブル作成・関連付け完了

### 2-5. サブネットの「パブリックIP自動割り当て」

`public-a` / `public-c` は **サブネットの操作 → サブネット設定を編集 → パブリックIPv4アドレスの自動割り当てを有効化**。private系は無効のままにする。

- [ ] 設定完了

---

## Part 3. セキュリティグループ設計

VPCコンソール → **セキュリティグループ → 作成**。すべて `travelmap-main-vpc` に作成（wireguard用のみ mgmt-vpc）。

| SG名 | インバウンド | アウトバウンド | 説明 |
|---|---|---|---|
| `travelmap-sg-alb` | 80, 443 / 0.0.0.0/0 | all | インターネットから受ける唯一の入口 |
| `travelmap-sg-app` | 8080, 3000 / **sg-alb のみ** | all | ALBからしか到達できない |
| `travelmap-sg-nat` | all traffic / **10.0.0.0/16**（main-vpc CIDR） | all | private subnet からのアウトバウンド中継 |
| `travelmap-sg-rds` | 5432 / **sg-app のみ** | all | App EC2からしか到達できない |
| `travelmap-sg-wireguard` | UDP 51820 / 0.0.0.0/0 | all | 自宅からのVPN接続（後で自宅IPに絞ってもよい） |

ポイント: `sg-app` や `sg-rds` の送信元は「CIDR」ではなく「**セキュリティグループ自体を参照**」で指定する。こうすると、対象のEC2/ALBが何台に増えてもルールを変更せずに済む（実務でもよく使う設計）。

- [ ] 5つのSG作成完了（wireguard用は Part 9 で mgmt-vpc に作成）

---

## Part 4. NATインスタンス

NAT Gatewayは時間課金（月$30程度）なので、無料枠内で完結させるため **自前のNATインスタンス**を使う。マネージドNAT Gatewayより手間はかかるが、その分「なぜNATが必要か」「iptablesで何をしているか」を語れるようになる。

### 4-1. 起動

EC2コンソール → **インスタンスを起動**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-nat` |
| AMI | Amazon Linux 2023 |
| インスタンスタイプ | `t3.micro`（無料枠対象。t3.nanoは無料枠対象外なので注意） |
| VPC / サブネット | `travelmap-main-vpc` / `travelmap-public-a` |
| パブリックIP自動割り当て | 有効 |
| セキュリティグループ | `travelmap-sg-nat` |
| キーペア | 作成 or 既存を使用（SSM前提なので任意） |

起動テンプレートの「高度な詳細 → ユーザーデータ」に以下を貼り付け、起動と同時にNAT化する:

```bash
#!/bin/bash
# IPフォワーディングを有効化
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
sysctl -p

# MASQUERADE でprivateサブネットからの通信を中継
IFACE=$(ip route show default | awk '{print $5}')
iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
iptables -F FORWARD
iptables -P FORWARD ACCEPT

# 再起動後もルールを保持
mkdir -p /etc/iptables
iptables-save > /etc/iptables/rules.v4
cat <<'EOF' > /etc/systemd/system/iptables-restore.service
[Unit]
Description=Restore iptables rules
Before=network-pre.target

[Service]
Type=oneshot
ExecStart=/sbin/iptables-restore /etc/iptables/rules.v4

[Install]
WantedBy=multi-user.target
EOF
systemctl enable iptables-restore.service
```

### 4-2. 送信元/送信先チェックを無効化

NATインスタンスの最重要設定。これを忘れると転送が一切効かない。

EC2コンソール → 対象インスタンス選択 → **アクション → ネットワーキング → 送信元/送信先の変更チェック → 停止**

- [ ] `travelmap-nat` 起動
- [ ] 送信元/送信先チェックを無効化
- [ ] Elastic IPを作成して `travelmap-nat` に関連付け（⚠️ 2024年2月以降、EC2にアタッチ中でもパブリックIPv4アドレスは時間課金される。詳細はPart 13の料金注意点を参照）

### 4-3. ルートテーブルにNATを設定

Part 2-4 で作った `travelmap-rt-private-app` を編集し、ルート `0.0.0.0/0` のターゲットを `travelmap-nat`（インスタンス）に設定する。

- [ ] ルート設定完了

---

## Part 5. RDS（PostgreSQL）

### 5-1. DBサブネットグループ

RDSコンソール → **サブネットグループ → 作成**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-db-subnet-group` |
| VPC | `travelmap-main-vpc` |
| サブネット | `private-db-a`, `private-db-c` |

### 5-2. DBインスタンス作成

RDSコンソール → **データベースの作成**

| 項目 | 値 |
|---|---|
| エンジン | PostgreSQL 16.x |
| テンプレート | **無料利用枠** |
| DB識別子 | `travelmap-db` |
| マスターユーザー名 | `travelmap` |
| マスターパスワード | 強いパスワードを生成して安全に保管（後で `DATABASE_URL` に使う） |
| インスタンスクラス | `db.t3.micro` |
| ストレージ | 20GB gp2（無料枠上限） |
| VPC | `travelmap-main-vpc` |
| サブネットグループ | `travelmap-db-subnet-group` |
| パブリックアクセス | **いいえ** |
| VPCセキュリティグループ | `travelmap-sg-rds` |
| 初期データベース名 | `travelmap` |

- [ ] `travelmap-db` 作成完了（数分かかる）
- [ ] 作成後、エンドポイント（`travelmap-db.xxxxx.ap-northeast-1.rds.amazonaws.com`）を控える

`DATABASE_URL` はこの形になる:

```
postgres://travelmap:<パスワード>@<エンドポイント>:5432/travelmap?sslmode=require
```

---

## Part 6. App EC2 + SSM Session Manager（踏み台なし）

### 6-1. IAMロール作成

IAMコンソール → **ロール → ロールを作成** → ユースケース「EC2」

| 項目 | 値 |
|---|---|
| ロール名 | `travelmap-app-role` |
| アタッチするポリシー | `AmazonSSMManagedInstanceCore` |

このポリシーだけで、SSHキーもインバウンドの22番ポートも無しにインスタンスへ接続できるようになる（踏み台サーバーが不要になる理由はここ）。

- [ ] `travelmap-app-role` 作成

### 6-2. App EC2起動

EC2コンソール → **インスタンスを起動**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-app` |
| AMI | Amazon Linux 2023 |
| インスタンスタイプ | `t3.micro` |
| VPC / サブネット | `travelmap-main-vpc` / `travelmap-private-app-a` |
| パブリックIP自動割り当て | 無効（そもそもprivateサブネットなので選べない） |
| セキュリティグループ | `travelmap-sg-app` |
| IAMインスタンスプロファイル | `travelmap-app-role` |

ユーザーデータ（Docker・Composeプラグイン・gitを起動時にインストール）:

```bash
#!/bin/bash
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

DOCKER_CONFIG=/usr/local/lib/docker
mkdir -p "$DOCKER_CONFIG/cli-plugins"
curl -sSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"

# t3.micro は1GBしかRAMが無いので、Next.jsのビルド用に1GBスワップを追加
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

- [ ] `travelmap-app` 起動

### 6-3. SSM Session Managerで接続確認

EC2コンソール → 対象インスタンス選択 → **接続 → Session Manager → 接続**

ブラウザ上のターミナルが開けば成功。SSHキーも踏み台サーバーも使っていないことを確認する。

- [ ] SSM接続確認
- [ ] `docker --version` / `docker compose version` が通ることを確認

> 接続できない場合は Part 12「詰まったときのチェックポイント」を参照。

---

## Part 7. アプリをデプロイする（手動）

> ✅ CI/CDを組んだ場合、このPartの手動デプロイは [`CICD_SETUP.md`](./CICD_SETUP.md) のPart Bで置き換えられる（GitHub Actionsが自動でビルド・配信する）。ただし、CI/CDの前提として、ここで一度リポジトリをclone・`.env`作成までは済ませておく必要があるので、CI/CDを先にやる場合もこのPartの手順（`git clone`と`.env`作成部分）は実施すること。

CI/CDを組むまでの間は、SSM Session Manager経由で手動デプロイする。

```bash
# SSM接続後のシェルで（ssm-userはsudoできる）
sudo su - ec2-user
git clone https://github.com/<あなたのGitHubユーザー名>/travelMap-app.git
cd travelMap-app

cat > .env <<'EOF'
JWT_SECRET=<openssl rand -hex 32 などで生成した値>
NEXT_PUBLIC_API_URL=https://<後で設定するドメイン or ALBのDNS名>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<あなたのキー>
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=<あなたのMap ID>
EOF

cat > backend/.env <<'EOF'
DATABASE_URL=postgres://travelmap:<RDSパスワード>@<RDSエンドポイント>:5432/travelmap?sslmode=require
FRONTEND_ORIGIN=https://<同上ドメイン>
EOF

# db サービス（ローカルpostgresコンテナ）は使わない。RDSに向けて backend/frontend だけ起動する
docker compose --env-file .env up -d --build backend frontend
```

- [ ] `docker compose ps` で `backend` / `frontend` が `Up` になっていることを確認
- [ ] `curl http://localhost:8080/api/me` などで backend の応答を確認（401でも「動いている」ことは分かる）

> このgit clone〜起動の手動作業は、次のフェーズでGitHub Actions + SSM SendCommandによるCI/CDに置き換える。

---

## Part 8. ALB（Application Load Balancer）

### 8-1. ターゲットグループ作成

EC2コンソール → **ターゲットグループ → 作成**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-tg-frontend` |
| ターゲットタイプ | インスタンス |
| プロトコル/ポート | HTTP / 3000 |
| VPC | `travelmap-main-vpc` |
| ヘルスチェックパス | `/` |
| 登録するターゲット | `travelmap-app` (ポート3000) |

同様に `travelmap-tg-backend`（ポート8080、ヘルスチェック `/api/me` などレスポンスが返るパス）も作成する。

### 8-2. ALB作成

EC2コンソール → **ロードバランサー → 作成 → Application Load Balancer**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-alb` |
| スキーム | インターネット向け |
| VPC | `travelmap-main-vpc` |
| サブネット | `public-a`, `public-c`（**異なる2AZが必須**） |
| セキュリティグループ | `travelmap-sg-alb` |
| リスナー 80 | デフォルトアクション → `travelmap-tg-frontend` に転送 |

リスナールールで `/api/*` へのパスは `travelmap-tg-backend` に転送するルールを追加する（フロントとバックエンドを1つのALBで振り分ける構成）。

- [ ] ALB作成完了
- [ ] DNS名（`travelmap-alb-xxxxx.ap-northeast-1.elb.amazonaws.com`）にブラウザでアクセスし、アプリが表示されることを確認

> ALBは新規アカウントで12ヶ月間無料（750時間+15GB処理）。無料期間が終わったら、EC2上のNginxで直接TLS終端する構成に縮退することもできる。

---

## Part 9. mgmt-vpc + WireGuard VPN + VPC Peering（発展）

ここまででアプリ自体は動く。この章は「VPNで社内網に入る」を実演するための発展パートなので、後回しにしても全体は成立する。

### 9-1. mgmt-vpc作成

Part 2と同様の手順で:

| 項目 | 値 |
|---|---|
| VPC名 | `travelmap-mgmt-vpc` |
| CIDR | `10.1.0.0/16` |
| サブネット | `travelmap-mgmt-public-a`（10.1.0.0/24, ap-northeast-1a） |
| IGW | `travelmap-mgmt-igw` をアタッチ |
| ルートテーブル | `0.0.0.0/0 → travelmap-mgmt-igw` |
| SG | `travelmap-sg-wireguard`（UDP 51820 / 0.0.0.0/0 inbound） |

- [ ] mgmt-vpc一式作成

### 9-2. VPC Peering接続

VPCコンソール → **ピアリング接続 → ピアリング接続を作成**

| 項目 | 値 |
|---|---|
| 名前 | `travelmap-peering` |
| リクエスタVPC | `travelmap-main-vpc` |
| アクセプタVPC | `travelmap-mgmt-vpc`（同アカウント・同リージョン） |

作成後、**アクセプタ側で「承認」**する。

ルートテーブルに追記:
- `travelmap-rt-private-app`: `10.1.0.0/16 → pcx-xxxxxxxx`
- `travelmap-mgmt-vpc` のルートテーブル: `10.0.0.0/16 → pcx-xxxxxxxx`

- [ ] Peering作成・承認
- [ ] 両VPCのルートテーブルに相互ルート追加

### 9-3. WireGuardサーバー構築

EC2起動（`travelmap-wireguard`, `t3.micro`, `mgmt-public-a`, `sg-wireguard`, パブリックIP有効）。起動後、Elastic IPを割り当てる（クライアント設定のEndpointを固定するため。⚠️ こちらも時間課金対象、詳細はPart 13）。

**送信元/送信先チェックを無効化**（NATインスタンスと同じ理由。トンネル越しの他ホスト宛パケットを転送するため）。

```bash
sudo dnf install -y wireguard-tools
cd /etc/wireguard

# サーバー鍵ペア
wg genkey | tee server_private.key | wg pubkey > server_public.key
chmod 600 server_private.key

cat > wg0.conf <<EOF
[Interface]
Address = 10.9.0.1/24
ListenPort = 51820
PrivateKey = $(cat server_private.key)
PostUp = sysctl -w net.ipv4.ip_forward=1; iptables -t nat -A POSTROUTING -s 10.9.0.0/24 -o eth0 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.9.0.0/24 -o eth0 -j MASQUERADE

# クライアントは Part 9-4 で追記
EOF

systemctl enable --now wg-quick@wg0
```

ポイント: `10.9.0.0/24` はWireGuardのトンネル内だけの仮想アドレス帯（VPCのCIDRとは別物）。`MASQUERADE` で、トンネル内クライアントからmain-vpc宛の通信を「WireGuardサーバー自身のIP（10.1.0.x）」に変換してから転送する。こうすることでmain-vpc側は特別なルートを増やさず、通常のPeeringルートだけで応答パケットを返せる。

### 9-4. クライアント（自宅PC）設定

```bash
# 自宅PC側
wg genkey | tee client_private.key | wg pubkey > client_public.key
```

`wg0.conf`（サーバー側）に追記:

```ini
[Peer]
PublicKey = <client_public.keyの中身>
AllowedIPs = 10.9.0.2/32
```

```bash
systemctl restart wg-quick@wg0
```

自宅PC側の設定ファイル（例: `client.conf`）:

```ini
[Interface]
PrivateKey = <client_private.keyの中身>
Address = 10.9.0.2/32

[Peer]
PublicKey = <server_public.keyの中身>
Endpoint = <WireGuard EC2のElastic IP>:51820
AllowedIPs = 10.0.0.0/16, 10.9.0.0/24
PersistentKeepalive = 25
```

`AllowedIPs = 10.0.0.0/16` が「トンネル経由でmain-vpc宛の通信だけをVPN越しにルーティングする」設定（フルトンネルにしない = 自宅の他の通信には影響しない）。

- [ ] WireGuard接続確認: `wg show` で `latest handshake` が表示される
- [ ] 自宅PCから `ping 10.0.10.x`（App EC2のプライベートIP）が通る
- [ ] （任意）App EC2のSSHをsg-appで `10.9.0.0/24` からのみ許可するルールを追加し、「SSMだけでなくVPN越しSSHでも到達できる」ことを実演

---

## Part 10. 独自ドメイン・HTTPS（Cloudflare、任意）

Route53のホストゾーンは月$0.5かかるので、無料で済ませたい場合はCloudflareを使う。

- [ ] ドメインを取得済みなら、Cloudflareにサイト追加してネームサーバーを向ける
- [ ] DNSレコード: `A` or `CNAME` で `travelmap-alb-xxxxx.ap-northeast-1.elb.amazonaws.com` を指す（プロキシ有効＝オレンジ雲にするとCDN/簡易WAFも無料で付く）
- [ ] SSL/TLS設定を「Full」にする（Cloudflare⇔ALB間もHTTPS化するなら、ACMでALBに証明書を発行してリスナーを443化。無料範囲で済ませるなら「Flexible」でも可だが、Full推奨）
- [ ] backend の `FRONTEND_ORIGIN` とfrontendの `NEXT_PUBLIC_API_URL` を本番ドメインに更新して再デプロイ

---

## Part 11. 動作確認チェックリスト

- [ ] ブラウザで本番URLにアクセスし、ログイン画面が表示される
- [ ] 新規登録 → ログイン → 場所を1件登録 → 地図に表示される
- [ ] 友だちリクエスト送受信ができる
- [ ] ランキングが表示される
- [ ] RDSのデータがEC2再起動後も消えない（RDSに保存されている証拠）
- [ ] SSM Session Managerでの接続はできるが、22番ポートはSG上どこにも開いていない（`sg-app`, `sg-nat` を確認）
- [ ] （WireGuard構築した場合）VPN未接続の状態からはApp EC2のプライベートIPにpingが通らないことを確認 → VPN接続後は通ることを確認

---

## Part 12. 詰まったときのチェックポイント

| 症状 | よくある原因 |
|---|---|
| private subnetのEC2がインターネットに出られない | NATインスタンスの「送信元/送信先チェック」を無効化し忘れ／`sg-nat`のインバウンドがmain-vpc CIDRを許可していない／`rt-private-app`のデフォルトルートがNATインスタンスを向いていない |
| SSM Session Managerで接続できない | IAMインスタンスプロファイルが付いていない／NAT経由のインターネット疎通がそもそも無い（SSMエージェントはSSMエンドポイントへ到達する必要がある）／リージョン違い |
| ALBのヘルスチェックが失敗し続ける | アプリが `0.0.0.0` ではなく `127.0.0.1` でLISTENしている／ターゲットグループのポートとコンテナの公開ポートが違う／`sg-app`がALBのSGからのインバウンドを許可していない |
| RDSに接続できない（`connection refused`/timeout） | `sg-rds`が`sg-app`からの5432を許可していない／DB Subnet Groupのサブネットが間違っている／`sslmode`不一致 |
| WireGuardのハンドシェイクが成立しない | `sg-wireguard`でUDP 51820が開いていない／クライアントのEndpointがElastic IPと一致していない／サーバー側`PostUp`のiptablesが実行されていない（`iptables -t nat -L`で確認） |
| VPN接続後もmain-vpc側に到達できない | Peering未承認／両VPCのルートテーブルにお互いのCIDRへのルートが無い／WireGuardサーバーの「送信元/送信先チェック」有効のまま |

---

## Part 13. コスト管理・後片付け

> ⚠️ **パブリックIPv4アドレスの課金について（2024年2月〜）**
> 以前はElastic IPが「稼働中インスタンスにアタッチされていれば無料」だったが、現在はEC2にアタッチ中でも、ALBに割り当てられていても、パブリックIPv4アドレス1個につき時間課金（目安 $0.005/時間 ≒ 月$3.6程度、リージョンにより異なる）される。この構成では NATインスタンス・WireGuardサーバーのEIP、およびALBのパブリックIPが対象になりうる。無料枠アカウントには別途一定時間分の無料枠が付与される場合があるが、変更される可能性があるので、必ず[AWS公式の最新の料金ページ](https://aws.amazon.com/jp/vpc/pricing/)で確認すること。「無料のはず」と思い込まず、Budgetsアラートを必ず設定しておく（Part 1参照）。

- [ ] Cost Explorerを定期的に確認する習慣をつける
- [ ] 使わない時間帯はEC2インスタンス（`travelmap-app`, `travelmap-nat`, `travelmap-wireguard`）を**停止**する（停止中は稼働時間課金は止まるが、EBSボリュームとElastic IPの未アタッチ分は課金され続ける点に注意）
- [ ] 完全に片付ける場合の削除順序（依存関係があるので順番が重要）:
  1. ALB → ターゲットグループ
  2. EC2インスタンス3台（app, nat, wireguard）
  3. RDSインスタンス（削除時に最終スナップショットを取るか選べる）
  4. Elastic IP（インスタンス削除後は自動で課金開始するので早めに解放）
  5. VPC Peering接続
  6. VPCそのもの（サブネット・IGW・ルートテーブルはVPC削除で連動して消える）

---

## 次のステップ

- CI/CD（GitHub Actions → ECR → SSM SendCommandでの自動デプロイ）は次のドキュメントで扱う
- 余裕があれば: VPC Flow Logs → CloudWatch Logsでトラフィック可視化、SSM用VPCエンドポイントの追加（NAT経由をやめてより閉域に近づける）、RDSのMulti-AZ化（ここは有料）
