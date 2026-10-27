#!/bin/bash
# Copy tree-sitter grammar WASM files into dist/grammars/
# This ensures they are bundled with the npm package and available
# when the package is installed via npx (where node_modules exists
# but grammar packages may not have their WASM files).
#
# Also copies the web-tree-sitter engine WASM.

set -e
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT_DIR/dist/grammars"
mkdir -p "$DEST_DIR"

# Source: node_modules/<pkg>/<wasm-file>
# Dest:   dist/grammars/<pkg>/<wasm-file>
copy_wasm() {
	local pkg="$1"
	local file="$2"
	local src="$ROOT_DIR/node_modules/$pkg/$file"
	local dest="$DEST_DIR/$pkg/$file"

	if [ "$pkg" = "tree-sitter-dart" ] || [ "$pkg" = "tree-sitter-kotlin" ] || [ "$pkg" = "tree-sitter-swift" ]; then
		local cache="$ROOT_DIR/.cache/wasm/$pkg/$file"
		mkdir -p "$(dirname "$dest")"
		if [ -f "$cache" ]; then
			cp "$cache" "$dest"
			echo "  ✓ $pkg/$file (cached)"
			return 0
		fi
		if [ "$pkg" = "tree-sitter-dart" ]; then
			echo "  → rebuilding $pkg/$file (prebuilt is incompatible ABI)"
		else
			echo "  → rebuilding $pkg/$file (no prebuilt WASM)"
		fi
		if ! npx --yes tree-sitter build --wasm -o "$dest" "$ROOT_DIR/node_modules/$pkg" 2>&1; then
			echo "  ✗ $pkg/$file REBUILD FAILED"
			return 1
		fi
		mkdir -p "$(dirname "$cache")"
		cp "$dest" "$cache"
		echo "  ✓ $pkg/$file (rebuilt)"
	elif [ "$pkg" = "tree-sitter-vue" ]; then
		mkdir -p "$(dirname "$dest")"
		# tree-sitter-vue C++ scanner uses std::string — incompatible with WASM.
		# Use the prebuilt WASM from tree-sitter-vue-wasm (pure C scanner port).
		WASM_PACK_DIR="$ROOT_DIR/.tmp/ts-vue-wasm-$$"
		rm -rf "$WASM_PACK_DIR"
		mkdir -p "$WASM_PACK_DIR"
		echo "  → fetching prebuilt WASM from tree-sitter-vue-wasm@0.1.0"
		# Force the nested pack to actually write its tarball even when the outer
		# command runs under dry-run (npm publish --dry-run / npm_config_dry_run=true
		# inherit into lifecycle scripts and would make `npm pack` a no-op).
		if npm_config_dry_run=false npm pack tree-sitter-vue-wasm@0.1.0 --pack-destination "$WASM_PACK_DIR" >/dev/null 2>&1; then
			TARBALL="$(ls "$WASM_PACK_DIR"/tree-sitter-vue-wasm-*.tgz 2>/dev/null | head -1)"
			if [ -n "$TARBALL" ]; then
				tar xzf "$TARBALL" -C "$WASM_PACK_DIR" package/tree-sitter-vue.wasm 2>/dev/null
				if [ -f "$WASM_PACK_DIR/package/tree-sitter-vue.wasm" ]; then
					cp "$WASM_PACK_DIR/package/tree-sitter-vue.wasm" "$dest"
					echo "  ✓ $pkg/$file (prebuilt WASM from tree-sitter-vue-wasm)"
				else
					echo "  ✗ $pkg/$file — WASM not found in package"
					rm -rf "$WASM_PACK_DIR"
					return 1
				fi
			else
				echo "  ✗ $pkg/$file — npm pack failed"
				rm -rf "$WASM_PACK_DIR"
				return 1
			fi
		else
			echo "  ✗ $pkg/$file — npm pack failed (offline?)"
			rm -rf "$WASM_PACK_DIR"
			return 1
		fi
		rm -rf "$WASM_PACK_DIR"
	elif [ -f "$src" ]; then
		mkdir -p "$(dirname "$dest")"
		cp "$src" "$dest"
		echo "  ✓ $pkg/$file"
	else
		echo "  ✗ $pkg/$file NOT FOUND"
	fi
}

echo "Copying grammar WASM files..."

# Grammar WASM files
copy_wasm "tree-sitter-javascript" "tree-sitter-javascript.wasm"
copy_wasm "tree-sitter-typescript" "tree-sitter-typescript.wasm"
copy_wasm "tree-sitter-typescript" "tree-sitter-tsx.wasm"
copy_wasm "tree-sitter-go"       "tree-sitter-go.wasm"
copy_wasm "tree-sitter-python"   "tree-sitter-python.wasm"
copy_wasm "tree-sitter-php"      "tree-sitter-php_only.wasm"
copy_wasm "tree-sitter-dart"     "tree-sitter-dart.wasm"
copy_wasm "tree-sitter-rust"     "tree-sitter-rust.wasm"
copy_wasm "tree-sitter-java"     "tree-sitter-java.wasm"
copy_wasm "tree-sitter-kotlin"   "tree-sitter-kotlin.wasm"
copy_wasm "tree-sitter-ruby"     "tree-sitter-ruby.wasm"
copy_wasm "tree-sitter-swift"    "tree-sitter-swift.wasm"
copy_wasm "tree-sitter-c"        "tree-sitter-c.wasm"
copy_wasm "tree-sitter-cpp"      "tree-sitter-cpp.wasm"
copy_wasm "tree-sitter-vue"     "tree-sitter-vue.wasm"

# Engine WASM (web-tree-sitter itself)
copy_wasm "web-tree-sitter"      "web-tree-sitter.wasm"

echo ""
echo "Done. Copied files:"
find "$DEST_DIR" -name "*.wasm" | sort
