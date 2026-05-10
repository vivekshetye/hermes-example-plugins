# hermes-example-plugins

Reference plugins for [hermes-agent](https://github.com/NousResearch/hermes-agent) — small, focused examples that show how a single plugin surface works, end to end.

These are **not bundled with `hermes-agent`**. The core repo ships only the plugins users actually run (memory providers, dashboard tabs, the disk-cleanup hook, platform adapters). Reference plugins live here so plugin authors can read them, copy them, install them as user plugins, and ignore them otherwise.

## Index

| Plugin | Surface | Demonstrates |
|---|---|---|
| [`plugin-llm-example`](./plugin-llm-example) | `ctx.llm.complete_structured()` | Host-owned structured LLM calls — typed text/image input, JSON Schema validation, trust-gate config |

## Installing an example as a user plugin

Each directory is a self-contained plugin. To run one in your own Hermes Agent setup:

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
cp -r hermes-example-plugins/plugin-llm-example ~/.hermes/plugins/

# enable it
hermes plugins enable plugin-llm-example
```

Then start a session — the plugin's slash command is available immediately. To uninstall, `rm -rf ~/.hermes/plugins/plugin-llm-example` and `hermes plugins disable plugin-llm-example`.

## Reading order for plugin authors

The plugins here are deliberately minimal — each one shows **one** plugin surface in the smallest amount of code that demonstrates it. The companion docs on each surface live in the main hermes-agent docs site under [Developer Guide → Extending](https://hermes-agent.nousresearch.com/docs/developer-guide/contributing).

Pair each plugin in this repo with its docs page:

| Plugin here | Docs page |
|---|---|
| `plugin-llm-example` | [Plugin LLM Access](https://hermes-agent.nousresearch.com/docs/developer-guide/plugin-llm-access) |

## Contributing a new example

Reference plugins should be:

- **Self-contained.** No deps beyond `hermes-agent` itself unless absolutely required.
- **Single-surface.** One plugin, one `ctx.*` API. If your example needs three `ctx.register_*` calls to make sense, it's probably not a reference example — it's a real plugin.
- **Under ~100 LOC of plugin code.** Reference plugins compete for attention with reading the docs page. Keep them small.
- **Production-shaped.** Use real types, real error handling, real audit logging — show plugin authors what we'd want them to write, not a stripped-down demo.

PRs welcome. Open an issue first if the surface you want to demonstrate isn't already covered in the hermes-agent developer-guide docs — we may want to write the docs page first, then add a companion reference plugin here.

## License

MIT, same as hermes-agent.
