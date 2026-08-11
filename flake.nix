{
  description = "residual — NKP Residuality architecture CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    crane.url = "github:ipetkov/crane";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, crane, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        };

        craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

        src = craneLib.cleanCargoSource ./.;

        commonArgs = {
          inherit src;
          strictDeps = true;
        };

        cargoArtifacts = craneLib.buildDepsOnly commonArgs;

        residual = craneLib.buildPackage (commonArgs // {
          inherit cargoArtifacts;
          pname = "residual";
          version = "0.1.0";
          cargoExtraArgs = "--locked";

          postInstall = ''
            # fish completions
            mkdir -p $out/share/fish/vendor_completions.d
            $out/bin/residual generate completions \
              > $out/share/fish/vendor_completions.d/residual.fish 2>/dev/null || true

            # man page
            mkdir -p $out/share/man/man1
            $out/bin/residual generate man \
              > $out/share/man/man1/residual.1 2>/dev/null || true
          '';

          meta = with pkgs.lib; {
            description = "NKP Residuality architecture CLI — stressor-driven, attractor-aware, probability-free";
            license = licenses.mit;
            mainProgram = "residual";
          };
        });

        checks = {
          inherit residual;
          residual-clippy = craneLib.cargoClippy (commonArgs // {
            inherit cargoArtifacts;
            cargoClippyExtraArgs = "--all-targets -- --deny warnings";
          });
          residual-fmt = craneLib.cargoFmt { inherit src; };
          residual-test = craneLib.cargoTest (commonArgs // {
            inherit cargoArtifacts;
          });
        };
      in {
        packages.default = residual;
        packages.residual = residual;

        inherit checks;

        devShells.default = craneLib.devShell {
          inputsFrom = [ residual ];
          packages = with pkgs; [
            cargo-watch    # cargo watch -x check
            cargo-audit    # cargo audit
            cargo-edit     # cargo add / upgrade
          ];

          shellHook = ''
            echo "residual dev — cargo check, cargo test, cargo watch -x check"
          '';
        };
      })
    // {
      overlays.default = final: prev: {
        residual = self.packages.${prev.stdenv.hostPlatform.system}.default;
      };
    };
}
