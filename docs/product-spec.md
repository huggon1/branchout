# Postrove product specification

Postrove searches social-media content through platform AI and parses submitted links into readable material. This document owns behavior and page flows. The root [README](../README.md) describes current source capabilities; live acceptance records describe observed platform results.

## Product scope

The application opens on Search. Content has fixed Parsed content and Search results destinations. Focus manages recurring conditions. The global header task panel shows execution status and exports native Pi logs. Settings manages model connections, platform sessions, Telegram, task browser visibility, application language, and application updates.

## Single-question search

Search accepts a question, selected platforms, and a content time range. Search executes these conditions and confirms task addition while retaining the form. Save as Follow opens a schedule editor and saves the conditions after schedule selection.

X uses Grok with an English question; Xiaohongshu uses 点点 AI with a Chinese question. Each platform starts a fresh conversation. Adaptation preserves the question's meaning and requests original social-media links. The content time range is sent to the platform AI; reported dates reflect available evidence.

Each run produces one independent report containing the original question, conditions, exact platform questions, original replies, and titled candidate links. The application confirms a stable platform answer and saves it before a second step extracts its citations. Source extraction uses that answer's inline links and source panel. A later extraction failure retains the answer and verified links and marks the report partial. A completed source inspection can record an empty source result. Successful sections remain readable when another platform fails.

Search results mixes manual and follow runs, newest first, with origin filters. Each platform section displays its original answer, source links, and retrieval state. Open Source opens a link. Add to Parsing submits the source and confirms task addition. Repeating the same canonical source within one report reuses its parsing task.

## Follows and scheduling

A follow stores a name, question, platforms, content time range, and daily or weekly schedule. Daily schedules select a time; weekly schedules select a weekday and time. The application displays the next execution in local time. The first automatic run occurs then.

The running application admits due occurrences. Occurrences missed while closed expire. Returning from sleep resumes future occurrences. A queued or running task for the same follow skips that occurrence. Different follows and manual searches enter one serial search queue.

Each admitted run freezes its conditions. Editing affects later admissions and recalculates the next execution. Pause stops future admissions; resume computes the next future time. Delete removes the follow and future plan. Existing reports retain their saved identity and conditions; admitted runs continue until completion or Stop.

## Link parsing and connections

Parsed content accepts an HTTPS link manually or from an authorized Telegram chat. The Agent collects the main text and images plus explicit direct materials, including quoted posts and author-supplied links, one level deep. GitHub repository scope is its default README. Accessible frames contribute ordinary page text and images.

Each material saves its source snapshot, translated Markdown, short introduction, retrieval coverage, and processing state. Reading preserves source order, headings, lists, tables, code, commands, identifiers, links, and image positions. Long text is translated in chunks. A failed or stopped task retains its saved sources and translated portions.

The reader lists the main material and direct references with their states. Selecting a material displays its source, introduction, coverage, and body in the run's saved language. Partial material shows its issue and available text. The reader preserves per-material reading position. Active Content records expose Stop.

Telegram acknowledges accepted links after local persistence and queue submission. Chat and message identities deduplicate receipt. Startup retrieves messages available after the saved Telegram cursor. [Data contracts](data-contracts.md#telegram-queue-and-business-reset) owns receipt and upgrade behavior.

## Recovery and task status

Browser execution retries transient model failures and repairs recoverable page actions within time and action budgets. Recovery observes the current page before repeating actions. Login, verification, and account agreements requiring human action end the affected platform section while other sections continue. Translation and introduction also retry transient connection failures. Exhausted recovery marks the parsing task failed and retains its sources and translated portions; translation fidelity validation permits one correction.

The global header task entry remains available while searching, reading, or configuring the app. Its panel groups active, failed, and ended work. Rows show state and stage; expanding a row shows update time, failure reason, activity, saved-result navigation, and native Pi export. The panel initially opens failures when present, otherwise active work or ended history. Individual clearing and Clear Ended hide terminal task history and preserve saved results and logs. Clear Ended includes completed, failed, and stopped records present at the time of the action. Each clear uses the eight-second recovery window. Escape or an outside click closes the panel and returns focus to the task entry. Application-update task links open this same panel. Content owns reading and Stop. A new search starts from Search; a new parsing request starts from Parsed content.

## Record deletion and recovery

Each task, parsed result, and search result exposes Delete through its More menu. Active records first offer Stop and Delete. Main completes Stop before saving deletion; a Stop failure leaves the record visible. Deleting a task entry preserves its saved content. Deleting a parsed result hides its main material and direct references together and retains task history. Deleting a search result retains its follow and independently submitted parsing records.

Deletion feedback offers Undo for eight seconds. Each operation has its own recovery action. Undo restores original identities and saved data; stopped execution stays stopped. Startup restores feedback for the remaining recovery window. Deleting the selected item selects its next neighbour, or its preceding neighbour at the list end. The last deletion shows the destination's empty state. Repeating Add to Parsing after result deletion creates a fresh parsing identity.

## Languages and runtime boundaries

Settings supports Simplified Chinese and English. Interface messages use the selected language. Generated reading material and saved execution messages use the language frozen for that run. Questions, platform replies, quotations, URLs, and identifiers keep their source wording.

Settings connects a general API or local Codex subscription login. Active execution retains its model connection lease. Shared Chrome preserves platform sessions. Task browsing defaults to headless; Settings can show task windows, with changes applied at the next browser operation. Platform login always opens a window. Credentials remain in controlled local storage. Source pages and replies are evidence data; application instructions control task actions.

The [data contracts](data-contracts.md#telegram-queue-and-business-reset) define the test-business reset and retained connections.

## Application updates

Installed macOS builds check the public GitHub Releases source five seconds after startup and every six hours. A new version produces a dismissible notice and a persistent sidebar entry. Settings shows the current version, last check, release notes, download progress, and retry actions. Source builds show the installed-build availability message.

Download starts when the user selects Download Update. Cancel returns to the available version. A downloaded update offers Install and Restart. Selecting this action during active search or parsing opens confirmation to install when current tasks finish. Confirmation pauses admission in both queues; new submissions remain queued. Cancel Waiting resumes admission. Once admitted work finishes and its worker cleanup completes, Main validates the native update, saves the receipt, shuts down services, and installs. A validation failure shows the installation error and resumes admission. Closing the application follows ordinary shutdown; installation starts through the update action.

The new version opens the same profile and shows a one-time completion notice. Queued searches and parsing resume on launch. Running searches that were interrupted retain the saved result and interruption state. [Release preparation](development.md#release-preparation) owns package and signing requirements.
