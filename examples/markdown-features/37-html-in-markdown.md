# HTML in Markdown

Most Markdown parsers allow raw HTML.

## Basic HTML

<div>
  This is a div element.
</div>

<span style="color: red;">Red text using inline style</span>

## Details/Summary (Collapsible)

<details>
<summary>Click to expand</summary>

This content is hidden by default!

- Item 1
- Item 2
- Item 3

</details>

## Centering Content

<div align="center">
  <h3>Centered Heading</h3>
  <p>Centered paragraph</p>
</div>

## Tables with HTML

<table>
  <tr>
    <th>Header 1</th>
    <th>Header 2</th>
  </tr>
  <tr>
    <td>Cell 1</td>
    <td>Cell 2</td>
  </tr>
</table>

## Images with HTML

<img src="https://via.placeholder.com/200x100" alt="Placeholder" width="200">

## Line Break

Line one<br>Line two<br>Line three

## Anchor with ID

<a id="my-anchor"></a>

Jump to [my anchor](#my-anchor).
