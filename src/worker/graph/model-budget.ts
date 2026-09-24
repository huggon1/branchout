export const MAX_MODEL_PAYLOAD_CHARS = 25_000;
export const MAX_MODEL_PAYLOAD_TOKENS = 5_200;
export const MAX_SNAPSHOT_PROMPT_TOKENS = 4_200;

export function estimateModelTokens(value: string) {
  const cjk =
    value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const other = [...value].length - cjk;
  return Math.ceil(cjk + other * 0.35);
}
