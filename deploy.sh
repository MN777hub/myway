#!/bin/sh
# MyWay auf GitHub Pages veroeffentlichen.
#
# Der Zweig gh-pages enthaelt den Inhalt von app/ in seiner Wurzel. Dadurch
# liegt die App unter https://mn777hub.github.io/myway/ und nicht unter
# .../myway/app/. Ein Actions-Workflow waere der uebliche Weg, braucht aber
# einen Token mit workflow-Rechten - subtree kommt ohne aus.
set -e
git push origin main
git subtree push --prefix app origin gh-pages
echo "Fertig: https://mn777hub.github.io/myway/"
