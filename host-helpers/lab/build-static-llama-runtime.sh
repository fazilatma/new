#!/usr/bin/env bash
# Reproducible, rootless compatibility laboratory for the shared-host runtime.
# Builds llama-server as a fully static x86_64-musl ELF, executes it, and
# rejects any dynamic loader, NEEDED entry, or GLIBC symbol before packaging.
set -Eeuo pipefail
umask 022

LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-${LAB_DIR}/output}"
JOBS="${LAB_JOBS:-2}"
LLAMA_COMMIT="b8f96c3e82284028cb077811ed1666caac3c5bac"
LLAMA_BUILD_NUMBER="11320"
SOURCE_SHA256="74dc3059c66b1d9c92190ec8d54ab5c4c1eea203fbc95cf6027ffa2975a6da55"
ASSET_NAME="llama-server-b11320-linux-x86_64-musl-static.tar.gz"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  printf 'This laboratory requires Linux x86_64.\n' >&2
  exit 2
fi
for command in python3 curl tar sha256sum readelf; do
  command -v "${command}" >/dev/null || { printf 'Missing laboratory command: %s\n' "${command}" >&2; exit 2; }
done
[[ "${JOBS}" =~ ^[1-9][0-9]*$ ]] || { printf 'LAB_JOBS must be a positive integer.\n' >&2; exit 2; }

mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd -- "${OUTPUT_DIR}" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openhands-host-lab.XXXXXX")"
trap 'rm -rf -- "${WORK_DIR}"' EXIT
TOOLS_DIR="${WORK_DIR}/tools"
SOURCE_DIR="${WORK_DIR}/source"
BUILD_DIR="${WORK_DIR}/build"
PACKAGE_DIR="${WORK_DIR}/package"
mkdir -p "${TOOLS_DIR}" "${SOURCE_DIR}" "${BUILD_DIR}" "${PACKAGE_DIR}"

printf '[lab] Installing hash-pinned rootless build tools...\n'
python3 -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  --only-binary=:all: \
  --require-hashes \
  --no-deps \
  --target "${TOOLS_DIR}" \
  --requirement "${LAB_DIR}/runtime-build-requirements.txt"
export PYTHONPATH="${TOOLS_DIR}"
CMAKE="${TOOLS_DIR}/bin/cmake"
NINJA="${TOOLS_DIR}/bin/ninja"
ZIG="${TOOLS_DIR}/ziglang/zig"
[[ -x "${CMAKE}" && -x "${NINJA}" && -x "${ZIG}" ]] || { printf 'Pinned tool installation is incomplete.\n' >&2; exit 1; }

printf '[lab] Fetching immutable llama.cpp source...\n'
curl --fail --silent --show-error --location --retry 5 \
  "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/${LLAMA_COMMIT}" \
  --output "${WORK_DIR}/llama.cpp.tar.gz"
printf '%s  %s\n' "${SOURCE_SHA256}" "${WORK_DIR}/llama.cpp.tar.gz" | sha256sum --check --strict
tar -xzf "${WORK_DIR}/llama.cpp.tar.gz" --strip-components=1 -C "${SOURCE_DIR}"

cat > "${WORK_DIR}/zig-cc" <<EOF
#!/bin/sh
exec "${ZIG}" cc -target x86_64-linux-musl -mcpu=x86_64 "\$@"
EOF
cat > "${WORK_DIR}/zig-cxx" <<EOF
#!/bin/sh
exec "${ZIG}" c++ -target x86_64-linux-musl -mcpu=x86_64 "\$@"
EOF
cat > "${WORK_DIR}/zig-ar" <<EOF
#!/bin/sh
exec "${ZIG}" ar "\$@"
EOF
cat > "${WORK_DIR}/zig-ranlib" <<EOF
#!/bin/sh
exec "${ZIG}" ranlib "\$@"
EOF
chmod 0755 "${WORK_DIR}/zig-cc" "${WORK_DIR}/zig-cxx" "${WORK_DIR}/zig-ar" "${WORK_DIR}/zig-ranlib"

printf '[lab] Building a static musl llama-server...\n'
cd "${WORK_DIR}"
"${CMAKE}" -S "${SOURCE_DIR}" -B "${BUILD_DIR}" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="${NINJA}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER="${WORK_DIR}/zig-cc" \
  -DCMAKE_CXX_COMPILER="${WORK_DIR}/zig-cxx" \
  -DCMAKE_AR="${WORK_DIR}/zig-ar" \
  -DCMAKE_RANLIB="${WORK_DIR}/zig-ranlib" \
  -DCMAKE_EXE_LINKER_FLAGS=-static \
  -DLLAMA_BUILD_COMMIT="${LLAMA_COMMIT:0:8}" \
  -DLLAMA_BUILD_NUMBER="${LLAMA_BUILD_NUMBER}" \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_CCACHE=OFF \
  -DLLAMA_OPENSSL=OFF \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_UI=OFF \
  -DLLAMA_USE_PREBUILT_UI=OFF
"${CMAKE}" --build "${BUILD_DIR}" --config Release --target llama-server --parallel "${JOBS}"

"${ZIG}" objcopy --strip-all "${BUILD_DIR}/bin/llama-server" "${PACKAGE_DIR}/llama-server"
chmod 0755 "${PACKAGE_DIR}/llama-server"
BINARY="${PACKAGE_DIR}/llama-server"

printf '[lab] Rejecting dynamic and glibc-linked output...\n'
readelf -h "${BINARY}" > "${OUTPUT_DIR}/runtime-elf-header.txt"
readelf -l "${BINARY}" > "${OUTPUT_DIR}/runtime-program-headers.txt"
readelf -d "${BINARY}" > "${OUTPUT_DIR}/runtime-dynamic-section.txt"
if grep -Eq 'INTERP|Requesting program interpreter' "${OUTPUT_DIR}/runtime-program-headers.txt"; then
  printf 'The runtime unexpectedly contains a dynamic interpreter.\n' >&2
  exit 1
fi
if grep -Eq '\(NEEDED\)|GLIBC_[0-9]' "${OUTPUT_DIR}/runtime-dynamic-section.txt" || \
   readelf --version-info "${BINARY}" | grep -Eq 'GLIBC_[0-9]'; then
  printf 'The runtime unexpectedly depends on a dynamic library or GLIBC symbol.\n' >&2
  exit 1
fi
if ! grep -Fq 'There is no dynamic section in this file.' "${OUTPUT_DIR}/runtime-dynamic-section.txt"; then
  printf 'The runtime dynamic-section check was inconclusive.\n' >&2
  exit 1
fi

printf '[lab] Executing the produced runtime...\n'
"${BINARY}" --version > "${OUTPUT_DIR}/runtime-version.txt" 2>&1
grep -Fq "${LLAMA_COMMIT:0:8}" "${OUTPUT_DIR}/runtime-version.txt"
BINARY_SHA256="$(sha256sum "${BINARY}" | cut -d' ' -f1)"
cat > "${PACKAGE_DIR}/PROVENANCE.txt" <<EOF
Runtime: llama-server
llama.cpp build: b${LLAMA_BUILD_NUMBER}
llama.cpp commit: ${LLAMA_COMMIT}
llama.cpp source SHA-256: ${SOURCE_SHA256}
compiler: Zig 0.13.0 / Clang 18.1.6
linkage: fully static x86_64-musl
GLIBC symbol requirement: none
OpenSSL: disabled
CURL: disabled
OpenMP: disabled
llama-server SHA-256: ${BINARY_SHA256}
EOF

printf '[lab] Packaging validated runtime...\n'
tar --sort=name --mtime='UTC 2026-01-01' --owner=0 --group=0 --numeric-owner \
  -czf "${OUTPUT_DIR}/${ASSET_NAME}" -C "${PACKAGE_DIR}" .
ASSET_SHA256="$(sha256sum "${OUTPUT_DIR}/${ASSET_NAME}" | cut -d' ' -f1)"
printf '%s  %s\n' "${BINARY_SHA256}" llama-server > "${OUTPUT_DIR}/runtime-binary.sha256"
printf '%s  %s\n' "${ASSET_SHA256}" "${ASSET_NAME}" > "${OUTPUT_DIR}/runtime-asset.sha256"
cat > "${OUTPUT_DIR}/lab-result.txt" <<EOF
status=passed
source_commit=${LLAMA_COMMIT}
source_sha256=${SOURCE_SHA256}
runtime_sha256=${BINARY_SHA256}
asset=${ASSET_NAME}
asset_sha256=${ASSET_SHA256}
linkage=static-musl
glibc_symbols=none
execution=passed
EOF
printf '[lab] PASS: %s\n' "${OUTPUT_DIR}/${ASSET_NAME}"
cat "${OUTPUT_DIR}/lab-result.txt"
