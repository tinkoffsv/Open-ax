import { describe, expect, it } from "vitest";
import { manifestEcosystem, normalizeDep, parseManifest } from "../src/scan/manifests.js";

const deps = (file: string, text: string) => parseManifest(file, text)!.deps;

describe("manifests", () => {
  it("recognizes manifest files", () => {
    expect(manifestEcosystem("backend/requirements-dev.txt")).toBe("python");
    expect(manifestEcosystem("web/package.json")).toBe("npm");
    expect(manifestEcosystem("build.gradle.kts")).toBe("jvm");
    expect(manifestEcosystem("README.md")).toBeNull();
  });

  it("normalizes Python names, extras and specifiers", () => {
    expect(normalizeDep("celery[redis]==5.4.0", "python")).toBe("celery");
    expect(normalizeDep("Flask_SQLAlchemy>=3", "python")).toBe("flask-sqlalchemy");
    expect(normalizeDep("zope.interface", "python")).toBe("zope-interface");
    expect(normalizeDep("@nestjs/core", "npm")).toBe("@nestjs/core");
  });

  it("parses requirements.txt", () => {
    const text = [
      "# web",
      "Flask==3.0.0",
      "psycopg2-binary==2.9.9  # postgres",
      "celery[redis]==5.4.0",
      "pydantic>=2.0.0,<3.0.0",
      "-r base.txt",
      "-e git+https://example.com/pkg.git#egg=pkg",
      "",
    ].join("\n");
    expect(deps("requirements.txt", text)).toEqual(["flask", "psycopg2-binary", "celery", "pydantic"]);
  });

  it("parses package.json across dependency sections", () => {
    const text = JSON.stringify({ dependencies: { react: "^18" }, devDependencies: { vite: "^5" }, scripts: { dev: "vite" } });
    expect(deps("package.json", text)).toEqual(["react", "vite"]);
    expect(deps("package.json", "{ not json")).toEqual([]);
  });

  it("parses pyproject.toml (PEP 621 and Poetry) without picking up other arrays", () => {
    const text = [
      "[project]",
      'name = "app"',
      'authors = ["Someone"]',
      "dependencies = [",
      '  "fastapi>=0.110",',
      '  "redis[hiredis]",',
      "]",
      "[project.optional-dependencies]",
      'test = ["pytest"]',
      "[tool.poetry.dependencies]",
      'python = "^3.12"',
      'celery = "^5"',
      "[tool.poetry.group.dev.dependencies]",
      'ruff = "*"',
    ].join("\n");
    expect(deps("pyproject.toml", text)).toEqual(["fastapi", "redis", "pytest", "celery", "ruff"]);
  });

  it("parses Pipfile, go.mod, Gemfile, composer.json, Cargo.toml and Gradle", () => {
    expect(deps("Pipfile", "[packages]\nrequests = \"*\"\n[dev-packages]\npytest = \"*\"\n[requires]\npython_version = \"3.12\"")).toEqual([
      "requests",
      "pytest",
    ]);
    expect(deps("go.mod", "module x\n\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.0.0\n\tgithub.com/lib/pq v1.10.0 // indirect\n)\nrequire github.com/stripe/stripe-go v1.0.0\n")).toEqual([
      "github.com/redis/go-redis/v9",
      "github.com/lib/pq",
      "github.com/stripe/stripe-go",
    ]);
    expect(deps("Gemfile", "source 'https://rubygems.org'\ngem 'rails', '~> 7'\ngem \"sidekiq\"\n")).toEqual(["rails", "sidekiq"]);
    expect(deps("composer.json", JSON.stringify({ require: { "laravel/framework": "^11" } }))).toEqual(["laravel/framework"]);
    expect(deps("Cargo.toml", "[dependencies]\ntokio = { version = \"1\" }\n[dependencies.serde]\nversion = \"1\"\n")).toEqual([
      "tokio",
      "serde",
    ]);
    expect(deps("build.gradle", "dependencies {\n  implementation 'org.postgresql:postgresql:42.7.0'\n}\n")).toEqual(["postgresql"]);
  });
});
