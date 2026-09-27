// Runs only in a short-lived Node child. The pinned Bird subset supplies the
// authenticated X request and its tweet/long-form normalization helpers.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [runtime, tweetId] = process.argv.slice(2);
if (!runtime || !/^\d{1,20}$/.test(tweetId)) process.exit(2);
const moduleAt = (name) =>
  import(pathToFileURL(join(runtime, "lib", name)).href);
const [
  { TwitterClientBase },
  { buildTweetDetailFeatures, buildArticleFieldToggles },
  utils,
  { TWITTER_API_BASE },
] = await Promise.all([
  moduleAt("twitter-client-base.js"),
  moduleAt("twitter-client-features.js"),
  moduleAt("twitter-client-utils.js"),
  moduleAt("twitter-client-constants.js"),
]);
const authToken = process.env.AUTH_TOKEN;
const ct0 = process.env.CT0;
if (!authToken || !ct0) process.exit(3);
const client = new TwitterClientBase({
  cookies: { authToken, ct0 },
  timeoutMs: 25000,
});
const variables = {
  focalTweetId: tweetId,
  with_rux_injections: false,
  rankingMode: "Relevance",
  includePromotedContent: false,
  withCommunity: true,
  withQuickPromoteEligibilityTweetFields: true,
  withBirdwatchNotes: true,
  withVoice: true,
};
for (const queryId of await client.getTweetDetailQueryIds()) {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(buildTweetDetailFeatures()),
    fieldToggles: JSON.stringify(buildArticleFieldToggles()),
  });
  const response = await client.fetchWithTimeout(
    `${TWITTER_API_BASE}/${queryId}/TweetDetail?${params}`,
    { method: "GET", headers: client.getHeaders(), redirect: "error" },
  );
  if (response.status === 404) continue;
  if (!response.ok) process.exit(4);
  const raw = await response.text();
  if (raw.length > 2_000_000) process.exit(5);
  const body = JSON.parse(raw);
  const direct = body.data?.tweetResult?.result;
  const instructions =
    body.data?.threaded_conversation_with_injections_v2?.instructions;
  const result =
    direct?.rest_id === tweetId
      ? direct
      : (utils.findTweetInInstructions(instructions, tweetId) ??
        utils
          .parseTweetsFromInstructions(instructions, { quoteDepth: 0 })
          .find((tweet) => tweet.id === tweetId));
  const tweet = result?.text
    ? result
    : utils.mapTweetResult(utils.unwrapTweetResult(result), { quoteDepth: 0 });
  if (!tweet || tweet.id !== tweetId) process.exit(6);
  await new Promise((resolve) =>
    process.stdout.write(JSON.stringify(tweet), resolve),
  );
  process.exit(0);
}
process.exit(7);
