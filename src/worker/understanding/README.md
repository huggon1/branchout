# Content understanding

`understanding` prepares general-understanding input for one submitted source snapshot. It organizes retrieved text, images, and completeness notes into model input and produces `GeneralUnderstanding`, saved separately from the source snapshot. See [data contracts](../../../docs/data-contracts.md#submitted-sources-and-reports).

`platform-content.ts` converts normalized source content into understanding input. `platforms` performs retrieval; the parent worker runs the task and delivers results.
