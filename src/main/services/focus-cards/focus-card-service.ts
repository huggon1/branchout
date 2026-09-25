import { randomUUID } from "node:crypto";
import {
  createFocusCardSchema,
  editFocusCardSchema,
  focusSetSnapshotSchema,
  setFocusCardActiveSchema,
  type FocusCard,
  type FocusVersion,
  type FocusSetSnapshot,
} from "../../../shared/focus-contracts";
import { ProjectStore } from "../../storage/project-store";

const now = () => new Date().toISOString();

export class FocusCardService {
  constructor(
    private readonly store: ProjectStore,
    private readonly changed: () => void = () => {},
  ) {}

  view() {
    const state = this.store.snapshot();
    return { focusCards: state.focusCards, focusVersions: state.focusVersions };
  }

  async create(raw: unknown): Promise<FocusCard> {
    const input = createFocusCardSchema.parse(raw);
    const timestamp = now();
    const card: FocusCard = {
      focusId: randomUUID(),
      projectId: input.projectId,
      currentVersionId: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const version: FocusVersion = {
      focusVersionId: card.currentVersionId,
      focusId: card.focusId,
      version: 1,
      content: input.content,
      active: true,
      change: "created",
      createdAt: timestamp,
    };
    await this.store.update((state) => {
      const project = state.projects.find(
        (item) => item.projectId === input.projectId,
      );
      if (!project || project.status !== "bound")
        throw new Error("请先绑定该项目");
      state.focusCards.push(card);
      state.focusVersions.push(version);
    });
    this.changed();
    return card;
  }

  async edit(raw: unknown): Promise<FocusVersion> {
    const input = editFocusCardSchema.parse(raw);
    let result!: FocusVersion;
    let updated = false;
    await this.store.update((state) => {
      const card = state.focusCards.find((item) => item.focusId === input.focusId);
      if (!card) throw new Error("关注卡不存在");
      const project = state.projects.find(
        (item) => item.projectId === card.projectId,
      );
      if (!project || project.status !== "bound")
        throw new Error("请先绑定该项目");
      if (card.currentVersionId !== input.expectedVersionId)
        throw new Error("关注卡已更新，请重新打开后编辑");
      const current = state.focusVersions.find(
        (item) => item.focusVersionId === card.currentVersionId,
      );
      if (!current) throw new Error("关注卡当前版本无法读取");
      if (current.content === input.content) {
        result = current;
        return;
      }
      const timestamp = now();
      result = {
        focusVersionId: randomUUID(),
        focusId: card.focusId,
        version: current.version + 1,
        content: input.content,
        active: current.active,
        change: "edited",
        createdAt: timestamp,
      };
      state.focusVersions.push(result);
      card.currentVersionId = result.focusVersionId;
      card.updatedAt = timestamp;
      updated = true;
    });
    if (updated) this.changed();
    return result;
  }

  async setActive(raw: unknown): Promise<FocusVersion> {
    const input = setFocusCardActiveSchema.parse(raw);
    let result!: FocusVersion;
    let updated = false;
    await this.store.update((state) => {
      const card = state.focusCards.find((item) => item.focusId === input.focusId);
      if (!card) throw new Error("关注卡不存在");
      const project = state.projects.find(
        (item) => item.projectId === card.projectId,
      );
      if (!project || project.status !== "bound")
        throw new Error("请先绑定该项目");
      if (card.currentVersionId !== input.expectedVersionId)
        throw new Error("关注卡已更新，请重新打开后操作");
      const current = state.focusVersions.find(
        (item) => item.focusVersionId === card.currentVersionId,
      );
      if (!current) throw new Error("关注卡当前版本无法读取");
      if (current.active === input.active) {
        result = current;
        return;
      }
      const timestamp = now();
      result = {
        ...current,
        focusVersionId: randomUUID(),
        version: current.version + 1,
        active: input.active,
        change: input.active ? "activated" : "paused",
        createdAt: timestamp,
      };
      state.focusVersions.push(result);
      card.currentVersionId = result.focusVersionId;
      card.updatedAt = timestamp;
      updated = true;
    });
    if (updated) this.changed();
    return result;
  }

  activeSnapshot(): FocusSetSnapshot {
    const state = this.store.snapshot();
    const boundProjects = new Map(
      state.projects
        .filter((project) => project.status === "bound")
        .map((project) => [project.projectId, project]),
    );
    const cards = state.focusCards.flatMap((card) => {
      const project = boundProjects.get(card.projectId);
      const version = state.focusVersions.find(
        (item) => item.focusVersionId === card.currentVersionId,
      );
      return project && version?.active
        ? [
            {
              projectId: project.projectId,
              projectLabel: project.name,
              focusId: card.focusId,
              focusVersionId: version.focusVersionId,
              content: version.content,
            },
          ]
        : [];
    });
    return focusSetSnapshotSchema.parse({ capturedAt: now(), cards });
  }

  readVersion(focusVersionId: string) {
    return this.store
      .snapshot()
      .focusVersions.find((item) => item.focusVersionId === focusVersionId);
  }
}
