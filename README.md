# Pipeliner

Obsidian plugin for adding properties to many notes at once.

## Usage

Select one or more notes (or folders) in the file explorer, right-click, and choose:

- **Add blank property**: adds `key:` with no value to every note that doesn't already have that property.
- **Add property with value**: adds `key: value` without overwriting anything:
  - property missing → added
  - property present but empty → filled in
  - property is a list → value appended (if it isn't already there)
  - property has any other value → left alone

Selecting a folder applies the action to every markdown note inside it, including subfolders.

The same menu items also appear in [Notebook Navigator](https://github.com/johansan/notebook-navigator)'s file and folder menus, if that plugin is installed.

## Development

```sh
npm install
npm run dev     # watch build
npm run build   # production build
```

To try it out, copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/pipeliner/`, then enable the plugin under Settings → Community plugins.
