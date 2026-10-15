"""Release regression tests; fixture signatures/keys are disposable, never production."""
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
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


if __name__ == "__main__":
    unittest.main()
