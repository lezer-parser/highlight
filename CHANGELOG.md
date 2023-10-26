## 1.1.7 (2023-10-26)

### Internal updates

Add support for ESM/bundler module resolution in TypeScript

## 1.1.6 (2023-05-26)

### Bug fixes

Fix a bug in  that could cause it to add random highlighting to the text between parts of an overlaid tree.

## 1.1.5 (2023-05-24)

### Bug fixes

Inheritable (`/...`) styles no longer apply across mounted subtrees.

## 1.1.4 (2023-03-24)

### Bug fixes

Make sure TypeScript declaration file has the same name as the ES module to avoid some TypeScript resolution issues.

## 1.1.3 (2022-11-25)

### Bug fixes

Fix a bug where the highlighting over overlaid ranges falling within a highlighted node in the parent tree was sometimes broken.

## 1.1.2 (2022-10-18)

### Bug fixes

Fix an issue where unmodified tags were treated as having higher specificity than modified ones when computing precedence for tags with multiple modifiers.

## 1.1.1 (2022-09-23)

### Bug fixes

Make sure `all` highlighting is applied even to nodes with no associated highlight tags.

## 1.1.0 (2022-09-20)

### New features

The new `getStyleTags` function can be used to query the style tags that match a given syntax nodes.

## 1.0.0 (2022-06-06)

### New features

First stable version.

## 0.16.0 (2022-04-20)

### Breaking changes

First numbered release.
