#!/usr/bin/env bash
set -Eeuo pipefail
set +x

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"
spec_file="$script_dir/anonymous-audio-regression.spec.json"
work_dir="${ANONYMOUS_AUDIO_WORK_DIR:-$root_dir/.tmp/anonymous-audio-regression}"
manifest_file="${ANONYMOUS_AUDIO_MANIFEST_FILE:-$root_dir/.artifacts/anonymous-audio-regression/manifest.json}"
upload="${UPLOAD_ANONYMOUS_AUDIO:-false}"
gcs_prefix="${ANONYMOUS_AUDIO_GCS_PREFIX:-}"

for command in say ffmpeg ffprobe jq openssl; do
  command -v "$command" >/dev/null || { echo "required command is unavailable: $command" >&2; exit 2; }
done
if [[ "$upload" == true ]]; then
  command -v gcloud >/dev/null || { echo "gcloud is required for private GCS upload" >&2; exit 2; }
  [[ "$gcs_prefix" =~ ^gs://[^/]+/anonymous-regression/[a-zA-Z0-9._/-]+$ ]] || {
    echo "ANONYMOUS_AUDIO_GCS_PREFIX must use a dedicated anonymous-regression prefix" >&2
    exit 2
  }
  target_bucket="${gcs_prefix#gs://}"
  target_bucket="${target_bucket%%/*}"
  [[ "$target_bucket" == monocle-503402-hanamaru-pilot-private ]] || {
    echo "anonymous audio may be uploaded only to the approved hanamaru-pilot private bucket" >&2
    exit 2
  }
  bucket_contract="$(gcloud storage buckets describe "gs://$target_bucket" --format=json)"
  [[ "$(jq -r '.uniform_bucket_level_access' <<<"$bucket_contract")" == true ]] || {
    echo "anonymous audio bucket must use uniform bucket-level access" >&2
    exit 2
  }
  [[ "$(jq -r '.public_access_prevention' <<<"$bucket_contract")" == enforced ]] || {
    echo "anonymous audio bucket must enforce public access prevention" >&2
    exit 2
  }
fi

mkdir -p "$work_dir" "$(dirname "$manifest_file")"
chmod 700 "$work_dir" "$(dirname "$manifest_file")"

speak(){
  local voice="$1" text="$2" output="$3"
  LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 say -v "$voice" -r 185 -o "$output" -- "$text"
}

silence(){
  ffmpeg -hide_banner -loglevel error -f lavfi -i anullsrc=r=16000:cl=mono -t "$1" -c:a pcm_s16le "$2" -y
}

build_profile(){
  local profile="$1"
  shift
  local profile_dir="$work_dir/$profile"
  local list_file="$profile_dir/concat.txt"
  mkdir -p "$profile_dir"
  chmod 700 "$profile_dir"
  : > "$list_file"
  local index=0 voice text aiff wav
  while (( $# > 0 )); do
    voice="$1"; text="$2"; shift 2
    index=$((index+1))
    aiff="$profile_dir/voice-$index.aiff"
    wav="$profile_dir/voice-$index.wav"
    speak "$voice" "$text" "$aiff"
    ffmpeg -hide_banner -loglevel error -i "$aiff" -ar 16000 -ac 1 -c:a pcm_s16le "$wav" -y
    printf "file '%s'\n" "$wav" >> "$list_file"
    silence 0.7 "$profile_dir/silence-$index.wav"
    printf "file '%s'\n" "$profile_dir/silence-$index.wav" >> "$list_file"
  done
  ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i "$list_file" -ar 16000 -ac 1 -b:a 64k "$work_dir/$profile.mp3" -y
  chmod 600 "$work_dir/$profile.mp3"
}

# All names, addresses, products and dialogue are intentionally fictional. The
# generated audio stays outside Git and no source text is copied to its manifest.
build_profile normal_dialogue \
  Kyoko "こんにちは。本日は査定の流れをご案内します。お品物を一つずつ確認してもよろしいでしょうか。" \
  Eddy "はい。架空のバッグと時計をお願いします。" \
  Kyoko "ありがとうございます。状態を確認した後に、査定理由と金額を順番にご説明します。" \
  Eddy "分かりました。お願いします。"

build_profile multi_speaker \
  Kyoko "本日の確認を始めます。架空の商品を一つずつ机の上へ置いてください。状態と付属品を順番に確認します。" \
  Eddy "こちらの架空商品をお願いします。購入時期は数年前ですが、普段は箱に入れて保管していました。" \
  Flo "付属品はこの箱に入っています。保証書と説明書もありますので、一緒に確認してください。" \
  Reed "購入時期の正確な日付は覚えていません。使用回数は少なく、目立つ傷はないと思います。" \
  Sandy "別の架空商品もあります。こちらは家族が使用していたため、詳しい購入場所は分かりません。" \
  Shelley "皆さまありがとうございます。六人の発話を区別しながら、確認事項を記録して進めてください。"

media_block="こちらは架空の情報番組です。市場、天気、交通、文化に関する一般的な話題を順番に紹介します。この説明は査定や接客とは関係のない、収録済み番組を想定した一方向の発話です。視聴者の皆さまへ架空のニュースと架空の解説をお届けしています。"
media_monologue=""
for _ in {1..12}; do media_monologue="${media_monologue}${media_block}"; done

build_profile media_mix \
  Kyoko "査定の前に、お品物とご希望を確認します。" \
  Eddy "架空の時計をお願いします。" \
  Reed "$media_monologue" \
  Kyoko "番組音声が混ざっているため、この録音は確認が必要です。"

profiles=(normal_dialogue multi_speaker media_mix)
manifest_entries='[]'
for profile in "${profiles[@]}"; do
  file="$work_dir/$profile.mp3"
  sha256="$(openssl dgst -sha256 -r "$file" | awk '{print $1}')"
  duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file")"
  codec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file")"
  gcs_uri=null
  generation=null
  if [[ "$upload" == true ]]; then
    gcs_uri="${gcs_prefix%/}/$profile.mp3"
    gcloud storage cp --quiet --if-generation-match=0 "$file" "$gcs_uri" >/dev/null
    generation="$(gcloud storage objects describe "$gcs_uri" --format='value(generation)')"
    [[ "$generation" =~ ^[1-9][0-9]*$ ]] || { echo "GCS generation read-back failed" >&2; exit 3; }
  fi
  expected_flags="$(jq -c --arg profile "$profile" '.profiles[] | select(.profile==$profile) | .expectedQualityFlags' "$spec_file")"
  if [[ "$profile" == multi_speaker ]]; then
    awk -v duration="$duration" 'BEGIN{exit !(duration>=45)}' || { echo "multi_speaker fixture is too short for stable diarization" >&2; exit 3; }
  elif [[ "$profile" == media_mix ]]; then
    awk -v duration="$duration" 'BEGIN{exit !(duration>=180)}' || { echo "media_mix fixture is too short for long_non_dialogue regression" >&2; exit 3; }
  fi
  manifest_entries="$(jq -c \
    --argjson entries "$manifest_entries" --arg profile "$profile" --arg sha "$sha256" \
    --arg duration "$duration" --arg codec "$codec" --arg uri "$gcs_uri" --arg generation "$generation" \
    --argjson flags "$expected_flags" \
    '$entries + [{profile:$profile,gcsUri:(if $uri=="null" then null else $uri end),generation:(if $generation=="null" then null else $generation end),sha256:$sha,durationSeconds:($duration|tonumber),codec:$codec,expectedQualityFlags:$flags}]' <<< '{}')"
done

jq -n --argjson entries "$manifest_entries" --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{schemaVersion:1,generatedAt:$generatedAt,profiles:$entries}' > "$manifest_file"
chmod 600 "$manifest_file"

if [[ "$upload" == true ]]; then
  node "$script_dir/validate-anonymous-audio-regression.mjs" "$manifest_file"
  echo "Anonymous regression audio uploaded and manifest verified."
else
  echo "Anonymous regression audio generated locally. Upload was not requested; release manifest is intentionally incomplete."
fi
