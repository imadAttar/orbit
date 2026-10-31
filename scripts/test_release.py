"""Release regression tests; fixture signatures/keys are disposable, never production."""
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_collect_includes_linux_and_windows_signature_sidecars(self):
        assert SPEC is not None and SPEC.loader is not None
        self.assertTrue(SPEC.origin and Path(SPEC.origin).exists(), "release helper not implemented")
        release = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(release)
        for platform, extension in [("linux-x64", "AppImage"), ("windows-x64", "msi")]:
            bundle = self.root / platform / "bundle"
            bundle.mkdir(parents=True)
            payload = bundle / f"Orbit_1.1.0_x64.{extension}"
            payload.write_bytes(b"installer fixture")
            payload.with_name(payload.name + ".sig").write_text("fixture-signature")
            output = self.root / platform / "output"
            release.collect(bundle, output, platform)
            self.assertTrue((output / payload.name).is_file())
            self.assertEqual((output / (payload.name + ".sig")).read_text(), "fixture-signature")

    def fixture(self):
        assert SPEC is not None and SPEC.loader is not None
        release = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(release)
        # This temporary key tests minisign interoperability; no real key is accessed.
        key = self.root / "fixture.key"
        public = self.root / "fixture.pub"
        subprocess.run(["minisign", "-G", "-W", "-s", str(key), "-p", str(public)], check=True, capture_output=True)
        pubkey = base64.b64encode(public.read_bytes()).decode()
        assets = self.root / "assets"
        assets.mkdir()
        for name in ["Orbit_aarch64-apple-darwin.app.tar.gz", "Orbit_1.1.0_amd64.AppImage", "Orbit_1.1.0_x64_en-US.msi"]:
            payload = assets / name
            payload.write_bytes(b"signed fixture payload " + name.encode())
            subprocess.run(["minisign", "-S", "-s", str(key), "-m", str(payload)], check=True, capture_output=True)
            signature = assets / (name + ".minisig")
            (assets / (name + ".sig")).write_text(base64.b64encode(signature.read_bytes()).decode())
            signature.unlink()
        for name in ["Orbit_1.1.0_aarch64.dmg", "Orbit_1.1.0_amd64.deb"]:
            (assets / name).write_bytes(b"installer fixture")
        return release, assets, pubkey

    def mac_fixture(self):
        release, assets, pubkey = self.fixture()
        for path in assets.iterdir():
            if not path.name.endswith((".dmg", ".app.tar.gz", ".app.tar.gz.sig")):
                path.unlink()
        (assets / "Orbit_1.1.0_aarch64.dmg").rename(assets / "Orbit_1.2.0_aarch64.dmg")
        return release, assets, pubkey

    def test_mac_only_prepares_and_verifies_exact_manifest_and_checksums(self):
        release, assets, pubkey = self.mac_fixture()
        output = self.root / "release-assets"
        platforms = ["macos-arm64"]
        self.assertEqual(set(release.expected_assets(assets, "1.2.0", platforms=platforms)), {"darwin-aarch64"})
        release.prepare(assets, output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=platforms)
        manifest = json.loads((output / "latest.json").read_text())
        self.assertEqual(manifest["version"], "1.2.0")
        self.assertEqual(set(manifest["platforms"]), {"darwin-aarch64"})
        self.assertIn("/v1.2.0/", manifest["platforms"]["darwin-aarch64"]["url"])
        checksums = (output / "SHA256SUMS").read_text().splitlines()
        self.assertEqual({line.split("  ")[1] for line in checksums},
                         {p.name for p in output.iterdir()} - {"SHA256SUMS"})
        release.verify(output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=platforms)
        with self.assertRaises(ValueError):
            release.verify(output, "v1.2.0", "imadAttar/orbit", pubkey)
        with self.assertRaises(ValueError):
            release.prepare(assets, self.root / "default-output", "v1.2.0", "imadAttar/orbit", pubkey)

    def test_cli_explicit_platforms_prepare_verify_and_default_fail_closed(self):
        _, assets, pubkey = self.mac_fixture()
        config = self.root / "src-tauri" / "tauri.conf.json"
        config.parent.mkdir()
        config.write_text(json.dumps({"plugins": {"updater": {"pubkey": pubkey}}}))
        output = self.root / "release-assets"
        assert SPEC is not None and SPEC.origin is not None
        common = [sys.executable, SPEC.origin, "--root", str(self.root),
                  "--output", str(output), "--tag", "v1.2.0"]
        result = subprocess.run(common + ["prepare", "--input", str(assets),
                                "--platforms", "macos-arm64"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(common + ["verify", "--platforms", "macos-arm64"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(common + ["verify"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        for selection in (["bogus"], []):
            result = subprocess.run(common + ["verify", "--platforms", *selection], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(config.read_text())["plugins"]["updater"]["pubkey"], pubkey)

    def test_platform_selection_rejects_empty_unknown_duplicate_and_bare_string(self):
        release, assets, _ = self.mac_fixture()
        for platforms in ([], ["unknown"], ["macos-arm64", "macos-arm64"], "macos-arm64"):
            with self.subTest(platforms=platforms):
                with self.assertRaisesRegex(ValueError, "platform selection"):
                    release.expected_assets(assets, "1.2.0", platforms=platforms)

    def test_mac_installer_requires_exact_version_and_architecture(self):
        release, assets, _ = self.mac_fixture()
        installer = assets / "Orbit_1.2.0_aarch64.dmg"
        for name in ("Orbit_1.1.0_aarch64.dmg", "Orbit_1.2.0_x64.dmg",
                     "Orbit_1.2.0_not-aarch64.dmg", "Orbit_1.2.0_aarch64_extra.dmg"):
            with self.subTest(name=name):
                renamed = installer.rename(assets / name)
                try:
                    with self.assertRaises(ValueError):
                        release.expected_assets(assets, "1.2.0", platforms=["macos-arm64"])
                finally:
                    renamed.rename(installer)

    def test_mac_verify_rejects_empty_installer_even_with_updated_checksums(self):
        release, assets, pubkey = self.mac_fixture()
        output = self.root / "release-assets"
        release.prepare(assets, output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=["macos-arm64"])
        next(output.glob("*.dmg")).write_bytes(b"")
        (output / "SHA256SUMS").write_text(release.checksum_text(output))
        with self.assertRaisesRegex(ValueError, "Empty asset"):
            release.verify(output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=["macos-arm64"])

    def test_mac_only_rejects_foreign_duplicate_or_orphan_assets(self):
        release, assets, pubkey = self.mac_fixture()
        for index, name in enumerate(("Orbit_1.2.0_amd64.AppImage", "Orbit_1.2.0_amd64.deb",
                                      "Orbit_1.2.0_x64_en-US.msi", "extra.sig",
                                      "Orbit_1.2.0_aarch64.dmg.sig", "second.app.tar.gz",
                                      "other.dmg", "notes.txt")):
            with self.subTest(name=name):
                extra = assets / name
                extra.write_bytes(b"unexpected fixture")
                try:
                    with self.assertRaises(ValueError):
                        release.prepare(assets, self.root / f"output-{index}", "v1.2.0",
                                        "imadAttar/orbit", pubkey, platforms=["macos-arm64"])
                finally:
                    extra.unlink()

    def test_mac_only_verification_rejects_tampering_and_missing_assets(self):
        release, assets, pubkey = self.mac_fixture()
        cases = ("payload", "signature", "missing-signature", "missing-updater", "missing-dmg",
                 "updater-name", "checksum-content", "checksum-coverage", "manifest-version",
                 "manifest-target", "manifest-url", "manifest-signature", "foreign-asset", "orphan")
        for index, case in enumerate(cases):
            with self.subTest(case=case):
                output = self.root / f"output-{index}"
                release.prepare(assets, output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=["macos-arm64"])
                payload = output / "Orbit_aarch64-apple-darwin.app.tar.gz"
                signature = payload.with_name(payload.name + ".sig")
                manifest_path = output / "latest.json"
                manifest = json.loads(manifest_path.read_text())
                entry = manifest["platforms"]["darwin-aarch64"]
                if case == "payload":
                    payload.write_bytes(b"tampered signed payload")
                elif case == "signature":
                    # Keep a syntactically valid envelope but corrupt its signed data.
                    envelope = bytearray(base64.b64decode(signature.read_text()))
                    lines = envelope.decode().splitlines()
                    raw = bytearray(base64.b64decode(lines[1]))
                    raw[-1] ^= 1
                    lines[1] = base64.b64encode(raw).decode()
                    forged = base64.b64encode(("\n".join(lines) + "\n").encode()).decode()
                    signature.write_text(forged)
                    entry["signature"] = forged
                    manifest_path.write_text(json.dumps(manifest))
                elif case == "missing-signature":
                    signature.unlink()
                elif case == "missing-updater":
                    payload.unlink()
                elif case == "missing-dmg":
                    next(output.glob("*.dmg")).unlink()
                elif case == "updater-name":
                    payload.rename(output / "Orbit_x86_64-apple-darwin.app.tar.gz")
                elif case.startswith("checksum"):
                    sums = output / "SHA256SUMS"
                    sums.write_text("0" * 64 + "  latest.json\n" if case == "checksum-content" else
                                    "\n".join(sums.read_text().splitlines()[1:]) + "\n")
                elif case.startswith("manifest"):
                    if case == "manifest-version":
                        manifest["version"] = "1.1.0"
                    elif case == "manifest-target":
                        manifest["platforms"]["windows-x86_64"] = dict(entry)
                    elif case == "manifest-url":
                        entry["url"] = entry["url"].replace("v1.2.0", "v1.1.0")
                    else:
                        entry["signature"] = "substituted signature"
                    manifest_path.write_text(json.dumps(manifest))
                else:
                    (output / ("extra.sig" if case == "orphan" else "Orbit_1.2.0_amd64.deb")).write_bytes(b"extra")
                # Except explicit checksum tests, recompute sums: SHA256 must not mask
                # missing assets, invalid crypto, or an incorrect manifest.
                if not case.startswith("checksum"):
                    (output / "SHA256SUMS").write_text(release.checksum_text(output))
                with self.assertRaises((ValueError, FileNotFoundError)):
                    release.verify(output, "v1.2.0", "imadAttar/orbit", pubkey, platforms=["macos-arm64"])

    def test_rejects_orphan_signature(self):
        release, assets, pubkey = self.fixture()
        (assets / "extra.sig").write_text("not a payload signature")
        with self.assertRaisesRegex(ValueError, "Unexpected asset"):
            release.prepare(assets, self.root / "release-assets", "v1.1.0", "imadAttar/orbit", pubkey)

    def test_rejects_tampered_payload(self):
        release, assets, pubkey = self.fixture()
        next(assets.glob("*.msi")).write_bytes(b"modified after signing")
        with self.assertRaisesRegex(ValueError, "Invalid updater signature"):
            release.prepare(assets, self.root / "release-assets", "v1.1.0", "imadAttar/orbit", pubkey)

    def test_rejects_missing_sidecar(self):
        release, assets, pubkey = self.fixture()
        next(assets.glob("*.AppImage.sig")).unlink()
        with self.assertRaises(FileNotFoundError):
            release.prepare(assets, self.root / "release-assets", "v1.1.0", "imadAttar/orbit", pubkey)

    def test_rejects_duplicate_asset_names(self):
        release, assets, pubkey = self.fixture()
        nested = assets / "duplicate"
        nested.mkdir()
        (nested / next(assets.glob("*.msi")).name).write_bytes(b"duplicate")
        with self.assertRaisesRegex(ValueError, "Duplicate asset"):
            release.prepare(assets, self.root / "release-assets", "v1.1.0", "imadAttar/orbit", pubkey)

    def test_rejects_checksum_tampering(self):
        release, assets, pubkey = self.fixture()
        output = self.root / "release-assets"
        release.prepare(assets, output, "v1.1.0", "imadAttar/orbit", pubkey)
        next(output.glob("*.deb")).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "SHA256SUMS mismatch"):
            release.verify(output, "v1.1.0", "imadAttar/orbit", pubkey)

    def test_rejects_manifest_url_tampering(self):
        release, assets, pubkey = self.fixture()
        output = self.root / "release-assets"
        release.prepare(assets, output, "v1.1.0", "imadAttar/orbit", pubkey)
        path = output / "latest.json"
        manifest = json.loads(path.read_text())
        manifest["platforms"]["linux-x86_64"]["url"] = "https://example.com/untrusted"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Manifest signature/URL mismatch"):
            release.verify(output, "v1.1.0", "imadAttar/orbit", pubkey)

    def test_version_check_requires_cargo_lock_package(self):
        release, _, _ = self.fixture()
        root = self.root / "repo"
        (root / "src-tauri").mkdir(parents=True)
        for name in ["package.json", "src-tauri/tauri.conf.json"]:
            (root / name).write_text(json.dumps({"version": "1.1.0"}))
        (root / "package-lock.json").write_text(json.dumps({"version": "1.1.0", "packages": {"": {"version": "1.1.0"}}}))
        (root / "src-tauri/Cargo.toml").write_text('[package]\nname = "orbit"\nversion = "1.1.0"\n')
        (root / "src-tauri/Cargo.lock").write_text('[[package]]\nname = "other"\nversion = "1.1.0"\n')
        with self.assertRaisesRegex(ValueError, "Orbit package"):
            release.check_version(root, "v1.1.0")
        (root / "src-tauri/Cargo.lock").write_text('[[package]]\nname = "orbit"\nversion = "1.1.0"\n')
        release.check_version(root, "v1.1.0")
        (root / "package.json").write_text(json.dumps({"version": "1.0.0"}))
        with self.assertRaisesRegex(ValueError, "Tag/config versions differ"):
            release.check_version(root, "v1.1.0")

    def test_collect_renames_mac_payload_and_keeps_matching_signature(self):
        assert SPEC is not None and SPEC.loader is not None
        release = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(release)
        bundle = self.root / "mac-bundle"
        bundle.mkdir()
        (bundle / "Orbit.app.tar.gz").write_bytes(b"mac updater")
        (bundle / "Orbit.app.tar.gz.sig").write_text("matching signature")
        (bundle / "Orbit_1.1.0_aarch64.dmg").write_bytes(b"mac installer")
        (bundle / "control.tar.gz").write_bytes(b"not an updater")
        output = self.root / "mac-output"
        release.collect(bundle, output, "macos-arm64")
        self.assertEqual({p.name for p in output.iterdir()}, {"Orbit_1.1.0_aarch64.dmg", "Orbit_aarch64-apple-darwin.app.tar.gz", "Orbit_aarch64-apple-darwin.app.tar.gz.sig"})
        (bundle / "Orbit.app.tar.gz.sig").unlink()
        with self.assertRaisesRegex(ValueError, "Missing updater signature"):
            release.collect(bundle, self.root / "missing-sig-output", "macos-arm64")

    def test_prepare_generates_three_verified_platforms_and_complete_checksums(self):
        release, assets, pubkey = self.fixture()
        output = self.root / "release-assets"
        release.prepare(assets, output, "v1.1.0", "imadAttar/orbit", pubkey)
        manifest = json.loads((output / "latest.json").read_text())
        self.assertEqual(manifest["version"], "1.1.0")
        self.assertEqual(set(manifest["platforms"]), {"darwin-aarch64", "linux-x86_64", "windows-x86_64"})
        self.assertTrue(all(p["signature"] for p in manifest["platforms"].values()))
        self.assertEqual(len((output / "SHA256SUMS").read_text().splitlines()), 9)
        release.verify(output, "v1.1.0", "imadAttar/orbit", pubkey)


    def test_release_native_matrix_is_macos_only(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/build.yml").read_text()
        native = workflow.split("  rust:\n", 1)[1]
        self.assertIn("        os: [macos-15]\n", native)
        self.assertNotIn("windows-latest", native)
        self.assertNotIn("ubuntu-22.04", native)
        release_workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/release.yml").read_text()
        self.assertIn("    needs: [check, preflight]\n", release_workflow)
        self.assertIn("    needs: build\n", release_workflow)
        self.assertIn("          draft: true\n", release_workflow)

    def test_native_ci_bounds_test_and_job_duration(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/build.yml").read_text()
        native = workflow.split("  rust:\n", 1)[1]
        self.assertIn("    timeout-minutes: 30\n", native)
        self.assertIn("      - name: Run Rust tests with bounded execution\n        timeout-minutes: 10\n        run: cargo test --manifest-path src-tauri/Cargo.toml --locked", native)


if __name__ == "__main__":
    unittest.main()
