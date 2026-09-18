// Project understanding reads fixed objects from an explicitly selected local
// Git checkout. GitHub remains an external public discovery source only.
export {
  localRepositoryRead as repositoryRead,
  createLocalRepositoryTools as createRepositoryTools,
} from "./local-git.mjs";
