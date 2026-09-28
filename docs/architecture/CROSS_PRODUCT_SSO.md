# 総務共通ログイン接続仕様（買取支援）

2026-09-28追補: `NEXT_PUBLIC_SSO_ISSUER`をWeb build argumentから渡す経路と、Terraformの空Secret容器2件を追加した。Secret値・API runtime注入・GCP配備は未実施。Googleログインは併存し、Drive OAuthは別機能のまま。

更新日: 2026-09-28
実装基準: `feat/cross-product-sso@b090c75`
共通仕様: [3製品共通SSO](../../../soumu-tool-prd/docs/architecture/three-product-sso.md)

## 現状

- ブラウザOIDC開始・callbackと共通ID token取得を実装。APIはBearer tokenを検証し、既存membership、organization、branch、capabilityで再認可する。
- Googleログインは現在のコードに残存する。OIDCとGoogleは同じ製品user/membership権限へ解決し、membershipや業務履歴を複製しない。
- Google Drive OAuthはログインと別機能で、共通ID利用後もDrive接続が必要な業務操作だけに使う。
- `/internal/sso/eligibility`は専用secretを要求し、対象organizationのactive membershipと有効なorganization-scope `manager` roleだけを返す。氏名、顧客情報、訪問内容は返さない。
- `feat/cross-product-sso@b090c75`はローカル実装であり、GCP runtime env/Secret/IAMの接続と配備は未完了。

## 認証と権限の流れ

1. Webの`/sso/start`から総務OIDCへ遷移し、PKCEを使って`/sso/callback`へ戻る。
2. 共通`sub`を事前承認済みの既存user IDへ解決し、短命共通access tokenを保持する。
3. APIが共通署名・issuer・audience・期限・status/logout epochを確認後、製品DBでmembershipとbranch/capabilityを再確認する。
4. 共通ID停止・失効・照会不能なら旧Bearerの次操作を拒否する。Googleで新たに認証し直す経路は現行仕様では残す。
5. 総務roleを買取支援のmanagerへコピーしない。manager権限は製品DBの有効membershipとorganization scopeから都度決める。

## 内部承認資格API

`POST /internal/sso/eligibility`は`SSO_APPROVAL_SECRET`と`x-sso-approval-secret`をconstant-time比較する。要求は製品user UUID、organization UUID、`target|approver`だけ。返却は同じID、`active`、現時点の有効organization managerなら`approver=true`のみ。APIは非公開ネットワークまたは呼出し元限定IAMで保護し、Soumu SSO管理service accountだけを許可する。

## Google経路の廃止境界

現在はGoogle login UI・Firebase token検証・Googleによる再認証が存在する。共通ログイン一本化を決める場合は、Googleログインボタン、Google ID token verifier、旧token session、移行済みsubject対応、停止時の拒否、Drive OAuthの再認可を分けて変更する。Drive OAuthをログインから誤って削除しない。利用者単位の切替期間、緊急復旧、全membership/branch role回帰が完了するまで廃止しない。

## GCP配備要件

- Web: `NEXT_PUBLIC_SSO_ISSUER`とcallback originをCloud Run Web revisionへ固定し、固定originをOIDC clientのredirect URIへ登録する。
- API: `SSO_ISSUER`、`SSO_INTERNAL_SECRET`、`SSO_APPROVAL_SECRET`を個別Secretとして注入する。Web/APIのservice account間で秘密を共有しない。
- `SSO_APPROVAL_SECRET`はSoumu管理serviceだけに渡す。API自体に資格情報やユーザーの業務データを書き込ませない。
- Web/API image digestを固定し、現行Blue/Green手順のno-traffic Green受入でOIDC、Google併存、membership、branch、Drive操作、logout/revokeを検証する。
- Googleログインは現状維持である。廃止を選んだ場合はこの仕様・Terraform/Identity Platform設定・ログインE2Eを同じリリースへ揃える。
