# CI/CD 手順書 — GitHub Actions → ECR → SSM デプロイ

前提: [`AWS_SETUP.md`](./AWS_SETUP.md) の Part 6（App EC2 + SSM）までは完了していること。RDS（Part 5）はまだでも、CI（ビルド/テスト）部分だけなら今すぐ着手できる。

## 全体の流れ

```
push to main
  │
  ▼
GitHub Actions (OIDC で一時的にAWSロールを引き受け。静的キーは一切保存しない)
  │
  ├─ backend/frontend の Docker image を build
  ├─ Amazon ECR に push（タグ: gitのshaと latest）
  │
  ▼
aws ssm send-command で App EC2（private subnet、インバウンドポート無し）に実行させる:
  git pull && infra/deploy.sh <backend_image> <frontend_image>
  │
  ▼
EC2は「自分自身のIAMロール」でECRから pull → docker compose up -d
```

ポイントは **GitHub Actions側のロール（push権限のみ）** と **EC2側のロール（pull権限のみ）** を完全に分離していること。どちらか一方が漏れても、もう一方の権限までは奪われない。

- [ ] 本ドキュメントの手順を上から実施
- [ ] Part A（CI）はAWS不要、今すぐ確認できる
- [ ] Part B（CD）はAWSリソースが必要

---

## Part A. CI（ビルド・テスト）— AWSなしで今すぐ動く

`.github/workflows/ci.yml` を作成済み。`pull_request` および `main`/`develop` への `push` で自動実行される。

内容:
- `backend`: `gofmt`チェック、`go vet`、`go build`、`go test`
- `frontend`: `npm run lint`、`npm run build`（`NEXT_PUBLIC_*`はダミー値でビルド確認のみ）
- `docker-build`: backend/frontend 両方のDockerfileが実際にビルドできるか確認（pushはしない）

- [ ] リポジトリをpush（またはPRを作成）して、GitHub Actionsの「Actions」タブでCIが緑になることを確認

これだけでも「コードが壊れたらすぐ分かる」状態になる。ここから先（Part B）は実際にAWSへ配る部分。

---

## Part B. CD（ECRへpush → EC2へ配る）

### B-1. ECRリポジトリ作成

```bash
aws ecr create-repository --repository-name travelmap-backend \
  --region ap-northeast-1 --image-scanning-configuration scanOnPush=true

aws ecr create-repository --repository-name travelmap-frontend \
  --region ap-northeast-1 --image-scanning-configuration scanOnPush=true
```

`scanOnPush=true` でイメージの脆弱性スキャンが自動で走る（無料）。ECRの無料枠はアカウント作成後12ヶ月間 500MB/月。ためすぎるとすぐ超えるので、ライフサイクルポリシーで古いイメージを自動削除しておく:

```bash
POLICY='{"rules":[{"rulePriority":1,"description":"keep last 5 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}'

aws ecr put-lifecycle-policy --repository-name travelmap-backend --lifecycle-policy-text "$POLICY"
aws ecr put-lifecycle-policy --repository-name travelmap-frontend --lifecycle-policy-text "$POLICY"
```

- [ ] `travelmap-backend` / `travelmap-frontend` リポジトリ作成
- [ ] ライフサイクルポリシー設定

### B-2. GitHub Actions用 OIDC プロバイダー作成（静的キーを使わないための仕組み）

IAMコンソール → **IDプロバイダ → プロバイダを追加 → OpenID Connect**

| 項目 | 値 |
|---|---|
| プロバイダのURL | `https://token.actions.githubusercontent.com` |
| 対象者（Audience） | `sts.amazonaws.com` |

「サムプリントを取得」ボタンでAWSが自動取得する。

CLIでやる場合:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea
```

- [ ] OIDCプロバイダ作成

> これが無いと、GitHub Actionsのワークフロー内に長期間有効なAWSアクセスキーをSecretsとして保存する必要が出てくる。OIDCなら実行の度に数分だけ有効な一時クレデンシャルが発行される。GitHub側に漏れても長期的な被害にならない、という点がポートフォリオでも語れる。

### B-3. GitHub Actions用 IAMロール作成

信頼ポリシー（**このリポジトリのmainブランチからのpushだけ**を許可。他のリポジトリや他のブランチからはこのロールを引き受けられない）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<あなたのGitHubユーザー名>/travelMap-app:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

権限ポリシー（ECR pushとSSM SendCommandのみ。EC2の起動・停止やVPC変更などは一切許可しない = 最小権限）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:BatchGetImage"
      ],
      "Resource": [
        "arn:aws:ecr:ap-northeast-1:<ACCOUNT_ID>:repository/travelmap-backend",
        "arn:aws:ecr:ap-northeast-1:<ACCOUNT_ID>:repository/travelmap-frontend"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-northeast-1:<ACCOUNT_ID>:instance/<travelmap-appのインスタンスID>",
        "arn:aws:ssm:ap-northeast-1::document/AWS-RunShellScript"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

IAMコンソール → **ロール → ロールを作成 → ウェブID → プロバイダ: 上で作ったOIDCプロバイダ / Audience: sts.amazonaws.com** で作成し、名前は `travelmap-github-deploy-role`。上記2つのポリシーをアタッチ（インラインポリシーでよい）。

- [ ] `travelmap-github-deploy-role` 作成
- [ ] ロールARNを控える（`arn:aws:iam::<ACCOUNT_ID>:role/travelmap-github-deploy-role`）

### B-4. App EC2 側にECR pull権限を追加

Part 6で作った `travelmap-app-role`（IAM）に、マネージドポリシー **`AmazonEC2ContainerRegistryReadOnly`** を追加アタッチする。

IAMコンソール → ロール → `travelmap-app-role` → 許可を追加 → ポリシーをアタッチ → `AmazonEC2ContainerRegistryReadOnly` を検索して追加。

- [ ] `travelmap-app-role` に読み取り専用ECR権限を追加

> ここで「GitHub Actions側はpushしかできない」「EC2側はpullしかできない」の非対称性が成立する。どちらかの認証情報が漏れても、もう片方の操作（イメージの改ざんpush、あるいはEC2自体の操作）はできない。

### B-5. App EC2側の初期セットアップ（1回だけ、SSM Session Manager経由）

`AWS_SETUP.md` Part 7 と同様にSession Managerで接続し、リポジトリをclone、`.env`を作成する（既にPart 7をやっていれば大部分は済んでいるはず）。

```bash
sudo su - ec2-user
cd travelMap-app || git clone https://github.com/<あなたのGitHubユーザー名>/travelMap-app.git && cd travelMap-app
git pull

cat > .env <<'EOF'
DATABASE_URL=postgres://travelmap:<RDSパスワード>@<RDSエンドポイント>:5432/travelmap?sslmode=require
FRONTEND_ORIGIN=https://<本番ドメイン or ALBのDNS名>
JWT_SECRET=<openssl rand -hex 32 の出力>
EOF
```

`infra/deploy.sh` は実行権限つきでリポジトリに入っているので、`git pull` すれば自動的に最新版が使われる。

- [ ] `.env` 作成確認（`BACKEND_IMAGE` / `FRONTEND_IMAGE` はこのファイルに書かない — デプロイの都度 `deploy.sh` が最新タグで上書きするため）

### B-6. GitHub側の設定

リポジトリ → **Settings → Secrets and variables → Actions**

**Secrets**（値を隠す必要があるもの）:

| 名前 | 値 |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | B-3で控えたロールARN |
| `EC2_INSTANCE_ID` | `travelmap-app` のインスタンスID（`i-xxxxxxxxxxxx`） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps APIキー |

**Variables**（機密ではないが環境ごとに変わる値）:

| 名前 | 値 |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<本番ドメイン>` |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Map ID |

- [ ] Secrets 3件・Variables 2件を設定

### B-7. 実行

`main` ブランチへpush（またはActionsタブから `workflow_dispatch` で手動実行）すると `deploy.yml` が走る。

- [ ] GitHub Actionsの実行ログで `Build and push backend image` / `frontend image` が成功
- [ ] `Deploy to App EC2 via SSM` ステップの `--- remote stdout ---` にdocker composeの出力が表示され、最後に `deploy succeeded` が出る
- [ ] ALB経由で本番URLにアクセスし、新しいイメージが反映されていることを確認（例: 適当な文言を1つ変えてpushし、反映を確認する）

失敗した場合、Systems Managerコンソールの **Run Command** 履歴からもコマンドの標準出力/エラーを直接確認できる。

---

## トラブルシューティング（CI/CD版）

| 症状 | よくある原因 |
|---|---|
| `AssumeRoleWithWebIdentity` で失敗 | 信頼ポリシーの `sub` がリポジトリ名/ブランチと一致していない（フォーク・別ブランチからのpushは弾かれる、これは仕様） |
| ECR push が `AccessDenied` | B-3の権限ポリシーのリポジトリARNが実際のリポジトリ名と食い違っている |
| SSMの `send-command` が `InvalidInstanceId` | `EC2_INSTANCE_ID` の値が違う、またはEC2がSSM Agentと疎通できていない（NAT経由の経路を確認） |
| EC2上で `docker login` が失敗 | B-4のECR読み取りポリシーがまだ反映されていない（IAMロールの変更はほぼ即時だが念のため数分待つ） |
| `docker compose pull` が古いイメージのまま | ECRに新しいタグが本当にpushされているか `aws ecr describe-images --repository-name travelmap-backend` で確認 |

---

## 次のステップ（任意）

- VPC Flow LogsをCloudWatch Logsに送り、SSMコマンドが通る際の実トラフィックを可視化する
- SSM用のVPCエンドポイント（`com.amazonaws.ap-northeast-1.ssm` など）を追加すると、NAT経由をやめて完全に閉域網の中だけでSSM通信が完結する構成にできる（より高度なネットワーク設計として語れる）
- `deploy.yml` にSlack通知やデプロイ失敗時のロールバック（直前のイメージタグに戻す）を追加する
