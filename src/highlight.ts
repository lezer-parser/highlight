import {Tree, NodeType, NodeProp, TreeCursor} from "@lezer/common"

let nextTagID = 0

/// Highlighting tags are markers that denote a highlighting category.
/// They are [associated](#highlight.styleTags) with parts of a syntax
/// tree by a language mode, and then mapped to an actual CSS style by
/// a [highlight style](#highlight.HighlightStyle).
///
/// Because syntax tree node types and highlight styles have to be
/// able to talk the same language, CodeMirror uses a mostly _closed_
/// [vocabulary](#highlight.tags) of syntax tags (as opposed to
/// traditional open string-based systems, which make it hard for
/// highlighting themes to cover all the tokens produced by the
/// various languages).
///
/// It _is_ possible to [define](#highlight.Tag^define) your own
/// highlighting tags for system-internal use (where you control both
/// the language package and the highlighter), but such tags will not
/// be picked up by regular highlighters (though you can derive them
/// from standard tags to allow highlighters to fall back to those).
export class Tag {
  /// @internal
  id = nextTagID++

  /// @internal
  constructor(
    /// The set of tags that match this tag, starting with this one
    /// itself, sorted in order of decreasing specificity. @internal
    readonly set: Tag[],
    /// The base unmodified tag that this one is based on, if it's
    /// modified @internal
    readonly base: Tag | null,
    /// The modifiers applied to this.base @internal
    readonly modified: readonly Modifier[]
  ) {}

  /// Define a new tag. If `parent` is given, the tag is treated as a
  /// sub-tag of that parent, and [highlight
  /// styles](#highlight.HighlightStyle) that don't mention this tag
  /// will try to fall back to the parent tag (or grandparent tag,
  /// etc).
  static define(parent?: Tag): Tag {
    if (parent?.base) throw new Error("Can not derive from a modified tag")
    let tag = new Tag([], null, [])
    tag.set.push(tag)
    if (parent) for (let t of parent.set) tag.set.push(t)
    return tag
  }

  /// Define a tag _modifier_, which is a function that, given a tag,
  /// will return a tag that is a subtag of the original. Applying the
  /// same modifier to a twice tag will return the same value (`m1(t1)
  /// == m1(t1)`) and applying multiple modifiers will, regardless or
  /// order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).
  ///
  /// When multiple modifiers are applied to a given base tag, each
  /// smaller set of modifiers is registered as a parent, so that for
  /// example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
  /// `m1(m3(t1)`, and so on.
  static defineModifier(): (tag: Tag) => Tag {
    let mod = new Modifier
    return (tag: Tag) => {
      if (tag.modified.indexOf(mod) > -1) return tag
      return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a, b) => a.id - b.id))
    }
  }
}

let nextModifierID = 0

class Modifier {
  instances: Tag[] = []
  id = nextModifierID++

  static get(base: Tag, mods: readonly Modifier[]) {
    if (!mods.length) return base
    let exists = mods[0].instances.find(t => t.base == base && sameArray(mods, t.modified))
    if (exists) return exists
    let set: Tag[] = [], tag = new Tag(set, base, mods)
    for (let m of mods) m.instances.push(tag)
    let configs = permute(mods)
    for (let parent of base.set) for (let config of configs)
      set.push(Modifier.get(parent, config))
    return tag
  }
}

function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a.length == b.length && a.every((x, i) => x == b[i])
}

function permute<T>(array: readonly T[]): (readonly T[])[] {
  let result = [array]
  for (let i = 0; i < array.length; i++) {
    for (let a of permute(array.slice(0, i).concat(array.slice(i + 1)))) result.push(a)
  }
  return result
}

/// This function is used to add a set of tags to a language syntax
/// via
/// [`LRParser.configure`](https://lezer.codemirror.net/docs/ref#lr.LRParser.configure).
///
/// The argument object maps node selectors to [highlighting
/// tags](#highlight.Tag) or arrays of tags.
///
/// Node selectors may hold one or more (space-separated) node paths.
/// Such a path can be a [node
/// name](https://lezer.codemirror.net/docs/ref#common.NodeType.name),
/// or multiple node names (or `*` wildcards) separated by slash
/// characters, as in `"Block/Declaration/VariableName"`. Such a path
/// matches the final node but only if its direct parent nodes are the
/// other nodes mentioned. A `*` in such a path matches any parent,
/// but only a single level—wildcards that match multiple parents
/// aren't supported, both for efficiency reasons and because Lezer
/// trees make it rather hard to reason about what they would match.)
///
/// A path can be ended with `/...` to indicate that the tag assigned
/// to the node should also apply to all child nodes, even if they
/// match their own style (by default, only the innermost style is
/// used).
///
/// When a path ends in `!`, as in `Attribute!`, no further matching
/// happens for the node's child nodes, and the entire node gets the
/// given style.
///
/// In this notation, node names that contain `/`, `!`, `*`, or `...`
/// must be quoted as JSON strings.
///
/// For example:
///
/// ```javascript
/// parser.withProps(
///   styleTags({
///     // Style Number and BigNumber nodes
///     "Number BigNumber": tags.number,
///     // Style Escape nodes whose parent is String
///     "String/Escape": tags.escape,
///     // Style anything inside Attributes nodes
///     "Attributes!": tags.meta,
///     // Add a style to all content inside Italic nodes
///     "Italic/...": tags.emphasis,
///     // Style InvalidString nodes as both `string` and `invalid`
///     "InvalidString": [tags.string, tags.invalid],
///     // Style the node named "/" as punctuation
///     '"/"': tags.punctuation
///   })
/// )
/// ```
export function styleTags(spec: {[selector: string]: Tag | readonly Tag[]}) {
  let byName: {[name: string]: Rule} = Object.create(null)
  for (let prop in spec) {
    let tags = spec[prop]
    if (!Array.isArray(tags)) tags = [tags as Tag]
    for (let part of prop.split(" ")) if (part) {
      let pieces: string[] = [], mode = Mode.Normal, rest = part
      for (let pos = 0;;) {
        if (rest == "..." && pos > 0 && pos + 3 == part.length) { mode = Mode.Inherit; break }
        let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest)
        if (!m) throw new RangeError("Invalid path: " + part)
        pieces.push(m[0] == "*" ? "" : m[0][0] == '"' ? JSON.parse(m[0]) : m[0])
        pos += m[0].length
        if (pos == part.length) break
        let next = part[pos++]
        if (pos == part.length && next == "!") { mode = Mode.Opaque; break }
        if (next != "/") throw new RangeError("Invalid path: " + part)
        rest = part.slice(pos)
      }
      let last = pieces.length - 1, inner = pieces[last]
      if (!inner) throw new RangeError("Invalid path: " + part)
      let rule = new Rule(tags, mode, last > 0 ? pieces.slice(0, last) : null)
      byName[inner] = rule.sort(byName[inner])
    }
  }
  return ruleNodeProp.add(byName)
}

const ruleNodeProp = new NodeProp<Rule>()

const enum Mode { Opaque, Inherit, Normal }

class Rule {
  constructor(readonly tags: readonly Tag[],
              readonly mode: Mode,
              readonly context: readonly string[] | null,
              public next?: Rule) {}

  sort(other: Rule | undefined) {
    if (!other || other.depth < this.depth) {
      this.next = other
      return this
    }
    other.next = this.sort(other.next)
    return other
  }

  get depth() { return this.context ? this.context.length : 0 }
}

export type Highlighter = (tags: readonly Tag[], scope: NodeType) => string | null

export function tagHighlighter(tags: readonly {tag: Tag | readonly Tag[], class: string}[], options?: {
  /// By default, highlighters apply to the entire document. You can
  /// scope them to a single language by providing the language's
  /// [top node](#language.Language.topNode) here.
  scope?: NodeType,
  /// Add a style to _all_ content. Probably only useful in
  /// combination with `scope`.
  all?: string
}): Highlighter {
  let map: {[tagID: number]: string | null} = Object.create(null)
  for (let style of tags) {
    if (!Array.isArray(style.tag)) map[(style.tag as Tag).id] = style.class
    else for (let tag of style.tag) map[tag.id] = style.class
  }
  let {scope: targetScope, all = null} = options || {}
  return (tags, scope) => {
    if (targetScope && scope != targetScope) return null
    let cls = all
    for (let tag of tags) {
      for (let sub of tag.set) {
        let tagClass = map[sub.id]
        if (tagClass) {
          cls = cls ? cls + " " + tagClass : tagClass
          break
        }
      }
    }
    return cls
  }
}

/// Combines an array of highlighters into a single highlight function
/// that returns all of the classes assigned for a given set of tags.
export function combinedHighlighter(highlighters: readonly Highlighter[]): Highlighter {
  if (highlighters.length == 1) return highlighters[0]
  return (tags, scope) => {
    let result = null
    for (let highlighter of highlighters) {
      let value = highlighter(tags, scope)
      if (value) result = result ? result + " " + value : value
    }
    return result
  }
}

/// Run the tree highlighter over the given tree.
export function highlightTree(
  tree: Tree,
  /// Get the CSS classes used to style a given [tag](#highlight.Tag),
  /// or `null` if it isn't styled. (You'll often want to pass a
  /// highlight style's [`match`](#highlight.HighlightStyle.match)
  /// method here.)
  highlighter: Highlighter,
  /// Assign styling to a region of the text. Will be called, in order
  /// of position, for any ranges where more than zero classes apply.
  /// `classes` is a space separated string of CSS classes.
  putStyle: (from: number, to: number, classes: string) => void,
  /// The start of the range to highlight.
  from = 0,
  /// The end of the range.
  to = tree.length,
) {
  let builder = new HighlightBuilder(from, highlighter, putStyle)
  builder.highlightRange(tree.cursor(), from, to, "", tree.type)
  builder.flush(to)
}

class HighlightBuilder {
  class = ""
  constructor(
    public at: number,
    readonly highlighter: Highlighter,
    readonly span: (from: number, to: number, cls: string) => void
  ) {}

  startSpan(at: number, cls: string) {
    if (cls != this.class) {
      this.flush(at)
      if (at > this.at) this.at = at
      this.class = cls
    }
  }

  flush(to: number) {
    if (to > this.at && this.class) this.span(this.at, to, this.class)
  }

  highlightRange(cursor: TreeCursor, from: number, to: number, inheritedClass: string, scope: NodeType) {
    let {type, from: start, to: end} = cursor
    if (start >= to || end <= from) return
    if (type.isTop) scope = type

    let cls = inheritedClass
    let rule = type.prop(ruleNodeProp), opaque = false
    while (rule) {
      if (!rule.context || cursor.matchContext(rule.context)) {
        let tagCls = this.highlighter(rule.tags, scope)
        if (tagCls) {
          if (cls) cls += " "
          cls += tagCls
          if (rule.mode == Mode.Inherit) inheritedClass += (inheritedClass ? " " : "") + tagCls
          else if (rule.mode == Mode.Opaque) opaque = true
        }
        break
      }
      rule = rule.next
    }

    this.startSpan(cursor.from, cls)
    if (opaque) return

    let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted)
    if (mounted && mounted.overlay) {
      let inner = cursor.node.enter(mounted.overlay[0].from + start, 1)!
      let hasChild = cursor.firstChild()
      for (let i = 0, pos = start;; i++) {
        let next = i < mounted.overlay.length ? mounted.overlay[i] : null
        let nextPos = next ? next.from + start : end
        let rangeFrom = Math.max(from, pos), rangeTo = Math.min(to, nextPos)
        if (rangeFrom < rangeTo && hasChild) {
          while (cursor.from < rangeTo) {
            this.highlightRange(cursor, rangeFrom, rangeTo, inheritedClass, scope)
            this.startSpan(Math.min(to, cursor.to), cls)
            if (cursor.to >= nextPos || !cursor.nextSibling()) break
          }
        }
        if (!next || nextPos > to) break
        pos = next.to + start
        if (pos > from) {
          this.highlightRange(inner.cursor, Math.max(from, next.from + start), Math.min(to, pos),
                              inheritedClass, mounted.tree.type)
          this.startSpan(pos, cls)
        }
      }
      if (hasChild) cursor.parent()
    } else if (cursor.firstChild()) {
      do {
        if (cursor.to <= from) continue
        if (cursor.from >= to) break
        this.highlightRange(cursor, from, to, inheritedClass, scope)
        this.startSpan(Math.min(to, cursor.to), cls)
      } while (cursor.nextSibling())
      cursor.parent()
    }
  }
}

const t = Tag.define

const comment = t(), name = t(), typeName = t(name), propertyName = t(name),
  literal = t(), string = t(literal), number = t(literal),
  content = t(), heading = t(content), keyword = t(), operator = t(),
  punctuation = t(), bracket = t(punctuation), meta = t()

/// The default set of highlighting [tags](#highlight.Tag^define) used
/// by regular language packages and themes.
///
/// This collection is heavily biased towards programming languages,
/// and necessarily incomplete. A full ontology of syntactic
/// constructs would fill a stack of books, and be impractical to
/// write themes for. So try to make do with this set. If all else
/// fails, [open an
/// issue](https://github.com/codemirror/codemirror.next) to propose a
/// new tag, or [define](#highlight.Tag^define) a local custom tag for
/// your use case.
///
/// Note that it is not obligatory to always attach the most specific
/// tag possible to an element—if your grammar can't easily
/// distinguish a certain type of element (such as a local variable),
/// it is okay to style it as its more general variant (a variable).
/// 
/// For tags that extend some parent tag, the documentation links to
/// the parent.
export const tags = {
  /// A comment.
  comment,
  /// A line [comment](#highlight.tags.comment).
  lineComment: t(comment),
  /// A block [comment](#highlight.tags.comment).
  blockComment: t(comment),
  /// A documentation [comment](#highlight.tags.comment).
  docComment: t(comment),

  /// Any kind of identifier.
  name,
  /// The [name](#highlight.tags.name) of a variable.
  variableName: t(name),
  /// A type [name](#highlight.tags.name).
  typeName: typeName,
  /// A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
  tagName: t(typeName),
  /// A property or field [name](#highlight.tags.name).
  propertyName: propertyName,
  /// An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
  attributeName: t(propertyName),
  /// The [name](#highlight.tags.name) of a class.
  className: t(name),
  /// A label [name](#highlight.tags.name).
  labelName: t(name),
  /// A namespace [name](#highlight.tags.name).
  namespace: t(name),
  /// The [name](#highlight.tags.name) of a macro.
  macroName: t(name),

  /// A literal value.
  literal,
  /// A string [literal](#highlight.tags.literal).
  string,
  /// A documentation [string](#highlight.tags.string).
  docString: t(string),
  /// A character literal (subtag of [string](#highlight.tags.string)).
  character: t(string),
  /// An attribute value (subtag of [string](#highlight.tags.string)).
  attributeValue: t(string),
  /// A number [literal](#highlight.tags.literal).
  number,
  /// An integer [number](#highlight.tags.number) literal.
  integer: t(number),
  /// A floating-point [number](#highlight.tags.number) literal.
  float: t(number),
  /// A boolean [literal](#highlight.tags.literal).
  bool: t(literal),
  /// Regular expression [literal](#highlight.tags.literal).
  regexp: t(literal),
  /// An escape [literal](#highlight.tags.literal), for example a
  /// backslash escape in a string.
  escape: t(literal),
  /// A color [literal](#highlight.tags.literal).
  color: t(literal),
  /// A URL [literal](#highlight.tags.literal).
  url: t(literal),

  /// A language keyword.
  keyword,
  /// The [keyword](#highlight.tags.keyword) for the self or this
  /// object.
  self: t(keyword),
  /// The [keyword](#highlight.tags.keyword) for null.
  null: t(keyword),
  /// A [keyword](#highlight.tags.keyword) denoting some atomic value.
  atom: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that represents a unit.
  unit: t(keyword),
  /// A modifier [keyword](#highlight.tags.keyword).
  modifier: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that acts as an operator.
  operatorKeyword: t(keyword),
  /// A control-flow related [keyword](#highlight.tags.keyword).
  controlKeyword: t(keyword),
  /// A [keyword](#highlight.tags.keyword) that defines something.
  definitionKeyword: t(keyword),
  /// A [keyword](#highlight.tags.keyword) related to defining or
  /// interfacing with modules.
  moduleKeyword: t(keyword),

  /// An operator.
  operator,
  /// An [operator](#highlight.tags.operator) that defines something.
  derefOperator: t(operator),
  /// Arithmetic-related [operator](#highlight.tags.operator).
  arithmeticOperator: t(operator),
  /// Logical [operator](#highlight.tags.operator).
  logicOperator: t(operator),
  /// Bit [operator](#highlight.tags.operator).
  bitwiseOperator: t(operator),
  /// Comparison [operator](#highlight.tags.operator).
  compareOperator: t(operator),
  /// [Operator](#highlight.tags.operator) that updates its operand.
  updateOperator: t(operator),
  /// [Operator](#highlight.tags.operator) that defines something.
  definitionOperator: t(operator),
  /// Type-related [operator](#highlight.tags.operator).
  typeOperator: t(operator),
  /// Control-flow [operator](#highlight.tags.operator).
  controlOperator: t(operator),

  /// Program or markup punctuation.
  punctuation,
  /// [Punctuation](#highlight.tags.punctuation) that separates
  /// things.
  separator: t(punctuation),
  /// Bracket-style [punctuation](#highlight.tags.punctuation).
  bracket,
  /// Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
  /// tokens).
  angleBracket: t(bracket),
  /// Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
  /// tokens).
  squareBracket: t(bracket),
  /// Parentheses (usually `(` and `)` tokens). Subtag of
  /// [bracket](#highlight.tags.bracket).
  paren: t(bracket),
  /// Braces (usually `{` and `}` tokens). Subtag of
  /// [bracket](#highlight.tags.bracket).
  brace: t(bracket),

  /// Content, for example plain text in XML or markup documents.
  content,
  /// [Content](#highlight.tags.content) that represents a heading.
  heading,
  /// A level 1 [heading](#highlight.tags.heading).
  heading1: t(heading),
  /// A level 2 [heading](#highlight.tags.heading).
  heading2: t(heading),
  /// A level 3 [heading](#highlight.tags.heading).
  heading3: t(heading),
  /// A level 4 [heading](#highlight.tags.heading).
  heading4: t(heading),
  /// A level 5 [heading](#highlight.tags.heading).
  heading5: t(heading),
  /// A level 6 [heading](#highlight.tags.heading).
  heading6: t(heading),
  /// A prose separator (such as a horizontal rule).
  contentSeparator: t(content),
  /// [Content](#highlight.tags.content) that represents a list.
  list: t(content),
  /// [Content](#highlight.tags.content) that represents a quote.
  quote: t(content),
  /// [Content](#highlight.tags.content) that is emphasized.
  emphasis: t(content),
  /// [Content](#highlight.tags.content) that is styled strong.
  strong: t(content),
  /// [Content](#highlight.tags.content) that is part of a link.
  link: t(content),
  /// [Content](#highlight.tags.content) that is styled as code or
  /// monospace.
  monospace: t(content),
  /// [Content](#highlight.tags.content) that has a strike-through
  /// style.
  strikethrough: t(content),

  /// Inserted text in a change-tracking format.
  inserted: t(),
  /// Deleted text.
  deleted: t(),
  /// Changed text.
  changed: t(),

  /// An invalid or unsyntactic element.
  invalid: t(),

  /// Metadata or meta-instruction.
  meta,
  /// [Metadata](#highlight.tags.meta) that applies to the entire
  /// document.
  documentMeta: t(meta),
  /// [Metadata](#highlight.tags.meta) that annotates or adds
  /// attributes to a given syntactic element.
  annotation: t(meta),
  /// Processing instruction or preprocessor directive. Subtag of
  /// [meta](#highlight.tags.meta).
  processingInstruction: t(meta),

  /// [Modifier](#highlight.Tag^defineModifier) that indicates that a
  /// given element is being defined. Expected to be used with the
  /// various [name](#highlight.tags.name) tags.
  definition: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that indicates that
  /// something is constant. Mostly expected to be used with
  /// [variable names](#highlight.tags.variableName).
  constant: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) used to indicate that
  /// a [variable](#highlight.tags.variableName) or [property
  /// name](#highlight.tags.propertyName) is being called or defined
  /// as a function.
  function: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that can be applied to
  /// [names](#highlight.tags.name) to indicate that they belong to
  /// the language's standard environment.
  standard: Tag.defineModifier(),
  /// [Modifier](#highlight.Tag^defineModifier) that indicates a given
  /// [names](#highlight.tags.name) is local to some scope.
  local: Tag.defineModifier(),

  /// A generic variant [modifier](#highlight.Tag^defineModifier) that
  /// can be used to tag language-specific alternative variants of
  /// some common tag. It is recommended for themes to define special
  /// forms of at least the [string](#highlight.tags.string) and
  /// [variable name](#highlight.tags.variableName) tags, since those
  /// come up a lot.
  special: Tag.defineModifier()
}

/// This is a highlight style that adds stable, predictable classes to
/// tokens, for styling with external CSS.
///
/// These tags are mapped to their name prefixed with `"cmt-"` (for
/// example `"cmt-comment"`):
///
/// * [`link`](#highlight.tags.link)
/// * [`heading`](#highlight.tags.heading)
/// * [`emphasis`](#highlight.tags.emphasis)
/// * [`strong`](#highlight.tags.strong)
/// * [`keyword`](#highlight.tags.keyword)
/// * [`atom`](#highlight.tags.atom) [`bool`](#highlight.tags.bool)
/// * [`url`](#highlight.tags.url)
/// * [`labelName`](#highlight.tags.labelName)
/// * [`inserted`](#highlight.tags.inserted)
/// * [`deleted`](#highlight.tags.deleted)
/// * [`literal`](#highlight.tags.literal)
/// * [`string`](#highlight.tags.string)
/// * [`number`](#highlight.tags.number)
/// * [`variableName`](#highlight.tags.variableName)
/// * [`typeName`](#highlight.tags.typeName)
/// * [`namespace`](#highlight.tags.namespace)
/// * [`className`](#highlight.tags.className)
/// * [`macroName`](#highlight.tags.macroName)
/// * [`propertyName`](#highlight.tags.propertyName)
/// * [`operator`](#highlight.tags.operator)
/// * [`comment`](#highlight.tags.comment)
/// * [`meta`](#highlight.tags.meta)
/// * [`punctuation`](#highlight.tags.puncutation)
/// * [`invalid`](#highlight.tags.invalid)
///
/// In addition, these mappings are provided:
///
/// * [`regexp`](#highlight.tags.regexp),
///   [`escape`](#highlight.tags.escape), and
///   [`special`](#highlight.tags.special)[`(string)`](#highlight.tags.string)
///   are mapped to `"cmt-string2"`
/// * [`special`](#highlight.tags.special)[`(variableName)`](#highlight.tags.variableName)
///   to `"cmt-variableName2"`
/// * [`local`](#highlight.tags.local)[`(variableName)`](#highlight.tags.variableName)
///   to `"cmt-variableName cmt-local"`
/// * [`definition`](#highlight.tags.definition)[`(variableName)`](#highlight.tags.variableName)
///   to `"cmt-variableName cmt-definition"`
/// * [`definition`](#highlight.tags.definition)[`(propertyName)`](#highlight.tags.propertyName)
///   to `"cmt-propertyName cmt-definition"`
export const classHighlighter = tagHighlighter([
  {tag: tags.link, class: "cmt-link"},
  {tag: tags.heading, class: "cmt-heading"},
  {tag: tags.emphasis, class: "cmt-emphasis"},
  {tag: tags.strong, class: "cmt-strong"},
  {tag: tags.keyword, class: "cmt-keyword"},
  {tag: tags.atom, class: "cmt-atom"},
  {tag: tags.bool, class: "cmt-bool"},
  {tag: tags.url, class: "cmt-url"},
  {tag: tags.labelName, class: "cmt-labelName"},
  {tag: tags.inserted, class: "cmt-inserted"},
  {tag: tags.deleted, class: "cmt-deleted"},
  {tag: tags.literal, class: "cmt-literal"},
  {tag: tags.string, class: "cmt-string"},
  {tag: tags.number, class: "cmt-number"},
  {tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "cmt-string2"},
  {tag: tags.variableName, class: "cmt-variableName"},
  {tag: tags.local(tags.variableName), class: "cmt-variableName cmt-local"},
  {tag: tags.definition(tags.variableName), class: "cmt-variableName cmt-definition"},
  {tag: tags.special(tags.variableName), class: "cmt-variableName2"},
  {tag: tags.definition(tags.propertyName), class: "cmt-propertyName cmt-definition"},
  {tag: tags.typeName, class: "cmt-typeName"},
  {tag: tags.namespace, class: "cmt-namespace"},
  {tag: tags.className, class: "cmt-className"},
  {tag: tags.macroName, class: "cmt-macroName"},
  {tag: tags.propertyName, class: "cmt-propertyName"},
  {tag: tags.operator, class: "cmt-operator"},
  {tag: tags.comment, class: "cmt-comment"},
  {tag: tags.meta, class: "cmt-meta"},
  {tag: tags.invalid, class: "cmt-invalid"},
  {tag: tags.punctuation, class: "cmt-punctuation"}
])
