# Platform enhancement

`xhs/` supplies the optional `read_xiaohongshu` tool for image/text notes. It normalizes the returned source identity, text, images, and coverage through the parent `types.ts`.

Current parsing enters `PlatformAccess.collect` and browser capture. The [architecture](../../../docs/architecture-overview.md#content-submission-pipeline) owns that pipeline.
