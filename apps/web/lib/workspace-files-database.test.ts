import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm, unlink } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  db,
  eq,
  organizations,
  users,
  repositories,
  tasks,
  workspaces,
  closeDatabase,
  persistGeneratedTaskTitle,
} from "@nimbus/database";
const fixture = vi.hoisted(() => ({
  id: `files_db_${Date.now()}`,
  tenant: "",
  anonymous: false,
}));
vi.mock("@/lib/auth", () => ({
  currentIdentity: async () =>
    fixture.anonymous ? null : { organizationId: fixture.tenant },
}));
import { GET } from "../app/api/tasks/[taskId]/files/route";
import {
  GET as artifactGET,
  POST as artifactPOST,
} from "../app/api/tasks/[taskId]/artifacts/route";
import {
  preservePdf,
  downloadTaskArtifact,
  listTaskArtifacts,
  preserveArtifact,
  preserveWorkspaceArtifacts,
} from "./task-artifacts";
const base = resolve(__dirname, "../../../.nimbus/workspaces");
const root = join(base, fixture.id);
const organizationId = `${fixture.id}_org`;
const userId = `${fixture.id}_user`;
const repoId = `${fixture.id}_repo`;
const context = { params: Promise.resolve({ taskId: fixture.id }) };
describe.runIf(process.env.NIMBUS_FILES_DATABASE_TEST === "true")(
  "file browsing with PostgreSQL task authorization",
  () => {
    beforeAll(async () => {
      fixture.tenant = organizationId;
      await db()
        .insert(users)
        .values({
          id: userId,
          email: `${randomUUID()}@example.invalid`,
          name: "File test",
        });
      await db().insert(organizations).values({
        id: organizationId,
        slug: organizationId,
        name: "File test",
      });
      await db().insert(repositories).values({
        id: repoId,
        organizationId,
        owner: "test",
        name: "files",
        fullName: "test/files",
        defaultBranch: "main",
        private: true,
      });
      await db().insert(tasks).values({
        id: fixture.id,
        organizationId,
        createdByUserId: userId,
        repositoryId: repoId,
        title: "Files test",
        objective: "Read source",
        baseRef: "main",
        status: "completed",
      });
      await db()
        .insert(workspaces)
        .values({
          id: `${fixture.id}_ws`,
          taskId: fixture.id,
          provider: "local-test",
          providerWorkspaceId: `local-${fixture.id}`,
          status: "ready",
          resourceLimits: {},
        });
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "README.md"), "owned repository contents\n");
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: root,
        windowsHide: true,
      });
      execFileSync("git", ["add", "README.md"], {
        cwd: root,
        windowsHide: true,
      });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Artifact Test",
          "-c",
          "user.email=artifact@example.invalid",
          "commit",
          "-qm",
          "Fixture baseline",
        ],
        { cwd: root, windowsHide: true },
      );
    });
    afterAll(async () => {
      await db().delete(tasks).where(eq(tasks.id, fixture.id));
      await db().delete(repositories).where(eq(repositories.id, repoId));
      await db()
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await db().delete(users).where(eq(users.id, userId));
      if (relative(base, root) === fixture.id)
        await rm(root, { recursive: true, force: true });
      const artifactBase = resolve(__dirname, "../../../.nimbus/artifacts");
      const artifactRoot = join(artifactBase, fixture.id);
      if (relative(artifactBase, artifactRoot) === fixture.id)
        await rm(artifactRoot, { recursive: true, force: true });
      await closeDatabase();
    });
    it("opens the actual unchanged workspace file", async () => {
      const response = await GET(
        new Request("http://localhost/api/files?operation=read&path=README.md"),
        context,
      );
      expect(response.status).toBe(200);
      expect((await response.json()).content).toBe(
        "owned repository contents\n",
      );
    });
    it("persists the first generated title once across follow-ups and concurrent updates", async () => {
      expect(
        await persistGeneratedTaskTitle(
          fixture.id,
          "another-tenant",
          "Wrong Tenant Title",
        ),
      ).toBe(false);
      expect(
        await persistGeneratedTaskTitle(
          fixture.id,
          organizationId,
          "<invalid>",
        ),
      ).toBe(false);
      const results = await Promise.all([
        persistGeneratedTaskTitle(
          fixture.id,
          organizationId,
          "Repository Architecture Overview",
        ),
        persistGeneratedTaskTitle(
          fixture.id,
          organizationId,
          "Another Session Title",
        ),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [before] = await db()
        .select()
        .from(tasks)
        .where(eq(tasks.id, fixture.id));
      expect(before!.titleGeneratedAt).not.toBeNull();
      expect(
        await persistGeneratedTaskTitle(
          fixture.id,
          organizationId,
          "Follow-up Should Not Rename",
        ),
      ).toBe(false);
      const [after] = await db()
        .select()
        .from(tasks)
        .where(eq(tasks.id, fixture.id));
      expect(after!.title).toBe(before!.title);
      expect(after!.titleGeneratedAt).toBe(before!.titleGeneratedAt);
    });
    it("cannot read another tenant's task even with the correct task ID and path", async () => {
      fixture.tenant = "another-tenant";
      for (const operation of ["tree", "read", "history"]) {
        const response = await GET(
          new Request(
            `http://localhost/api/files?operation=${operation}&path=README.md`,
          ),
          context,
        );
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain("owned repository");
      }
      fixture.tenant = organizationId;
    });
    it("rejects directory traversal and Git internals on an authorized task", async () => {
      for (const path of [
        "../README.md",
        ".git/config",
        "C:/Windows/win.ini",
        ".git./config",
      ]) {
        const response = await GET(
          new Request(
            `http://localhost/api/files?operation=read&path=${encodeURIComponent(path)}`,
          ),
          context,
        );
        expect(response.status).toBe(400);
      }
    });
    it("preserves PDF versions idempotently and downloads after the source is deleted", async () => {
      fixture.tenant = organizationId;
      const repositoryRoot = resolve(__dirname, "../../..");
      const pdf = Buffer.from("%PDF-1.4\nfixture version one\n%%EOF\n");
      await writeFile(join(root, "report.pdf"), pdf);
      const id = await preservePdf(repositoryRoot, fixture.id, "report.pdf");
      expect(await preservePdf(repositoryRoot, fixture.id, "report.pdf")).toBe(
        id,
      );
      expect(await listTaskArtifacts(fixture.id)).toHaveLength(1);
      await writeFile(
        join(root, "report.pdf"),
        "%PDF-1.4\nfixture version two\n%%EOF\n",
      );
      expect(
        await preservePdf(repositoryRoot, fixture.id, "report.pdf"),
      ).not.toBe(id);
      expect(await listTaskArtifacts(fixture.id)).toHaveLength(2);
      await unlink(join(root, "report.pdf"));
      expect(
        (await downloadTaskArtifact(repositoryRoot, fixture.id, id)).data,
      ).toEqual(pdf);
      const response = await artifactGET(
        new Request(`http://localhost/api/artifacts?download=${id}`),
        context,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toContain(
        "attachment;",
      );
      expect(response.headers.get("content-disposition")).toContain(
        "report.pdf",
      );
      expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
      fixture.tenant = "another-tenant";
      expect(
        (
          await artifactGET(
            new Request(`http://localhost/api/artifacts?download=${id}`),
            context,
          )
        ).status,
      ).toBe(404);
      fixture.tenant = organizationId;
      expect(
        (
          await artifactPOST(
            new Request("http://localhost/api/artifacts", {
              method: "POST",
              headers: { origin: "https://attacker.invalid" },
              body: "{}",
            }),
            context,
          )
        ).status,
      ).toBe(403);
    });
    it("rejects false or incomplete PDFs and escaped artifact paths", async () => {
      const repositoryRoot = resolve(__dirname, "../../..");
      await writeFile(join(root, "invalid.pdf"), "not a PDF");
      await expect(
        preservePdf(repositoryRoot, fixture.id, "invalid.pdf"),
      ).rejects.toThrow("not a PDF");
      await writeFile(
        join(root, "incomplete.pdf"),
        "%PDF-1.4\nstill being written",
      );
      await expect(
        preservePdf(repositoryRoot, fixture.id, "incomplete.pdf"),
      ).rejects.toThrow("still being generated");
      await expect(
        preservePdf(repositoryRoot, fixture.id, "../outside.pdf"),
      ).rejects.toThrow("Invalid repository path");
      await unlink(join(root, "invalid.pdf"));
      await unlink(join(root, "incomplete.pdf"));
    });
    it("preserves and downloads every output type with exact bytes and original filenames", async () => {
      fixture.tenant = organizationId;
      const repositoryRoot = resolve(__dirname, "../../..");
      for (const name of [
        "report.xlsx",
        "report.docx",
        "slides.pptx",
        "script.py",
        "notes.md",
        "data.csv",
        "bundle.zip",
        "unknown.custom",
        "no-extension",
      ]) {
        const bytes = Buffer.from([0, 255, 1, 2, 3, 4]);
        await writeFile(join(root, name), bytes);
        const id = await preserveArtifact(repositoryRoot, fixture.id, name);
        expect(await preserveArtifact(repositoryRoot, fixture.id, name)).toBe(
          id,
        );
        const response = await artifactGET(
          new Request(`http://localhost/api/artifacts?download=${id}`),
          context,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-disposition")).toContain(name);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      }
      await writeFile(join(root, ".env.local"), "do not publish");
      await expect(
        preserveArtifact(repositoryRoot, fixture.id, ".env.local"),
      ).rejects.toThrow("Credential files");
    });
    it("automatically captures generated and changed files but not untouched repository files or credentials", async () => {
      const repositoryRoot = resolve(__dirname, "../../..");
      await mkdir(join(root, "node_modules"));
      await writeFile(join(root, "node_modules", "ignored.txt"), "dependency");
      await preserveWorkspaceArtifacts(
        repositoryRoot,
        fixture.id,
        undefined,
        "main",
      );
      let saved = await listTaskArtifacts(fixture.id);
      expect(saved.map((item) => item.name)).toContain("report.xlsx");
      expect(saved.map((item) => item.name)).toContain("no-extension");
      expect(saved.map((item) => item.name)).not.toContain("README.md");
      expect(saved.map((item) => item.name)).not.toContain(".env.local");
      expect(saved.map((item) => item.name)).not.toContain(
        "node_modules/ignored.txt",
      );
      await writeFile(join(root, "README.md"), "updated by agent\n");
      await preserveWorkspaceArtifacts(
        repositoryRoot,
        fixture.id,
        undefined,
        "main",
      );
      saved = await listTaskArtifacts(fixture.id);
      expect(saved.map((item) => item.name)).toContain("README.md");
    });
  },
);
