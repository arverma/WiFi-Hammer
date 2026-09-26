VERSION := $(shell node -p "require('./manifest.json').version")
DIST := dist
STAGE := $(DIST)/stage
ZIP := $(DIST)/wifi-hammer-$(VERSION).zip

.PHONY: all check package clean

all: package

check:
	node --check background.js
	node --check popup.js
	node tests.js
	@if grep -E '<(script|link)[^>]*(src|href)="https?://' popup.html >/dev/null; then \
		echo "popup.html loads a remote script or stylesheet"; \
		exit 1; \
	fi
	@node -e 'const fs=require("fs"); const m=require("./manifest.json"); if(m.manifest_version!==3) throw new Error("Manifest V3 is required"); if(m.name.length>45) throw new Error("Name exceeds the 45-character Chrome listing limit"); if((m.description||"").length>132) throw new Error("Description exceeds 132 characters"); for (const size of ["16","32","48","128"]) { const path=m.icons&&m.icons[size]; if(!path||!fs.existsSync(path)) throw new Error("Missing "+size+" icon"); }'

package: check
	rm -rf "$(STAGE)" "$(ZIP)"
	mkdir -p "$(STAGE)/icons" "$(STAGE)/images" "$(STAGE)/fonts"
	cp manifest.json background.js popup.js popup.html popup.css "$(STAGE)/"
	cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$(STAGE)/icons/"
	cp images/hammer.png "$(STAGE)/images/"
	cp fonts/inter-latin-wght-normal.woff2 fonts/OFL.txt "$(STAGE)/fonts/"
	cd "$(STAGE)" && COPYFILE_DISABLE=1 zip -r -X -D -q "../wifi-hammer-$(VERSION).zip" . -x '*.DS_Store' -x '*/.DS_Store'
	rm -rf "$(STAGE)"
	@ZIP="$(ZIP)" node -e 'const {execFileSync}=require("child_process"); const zip=process.env.ZIP; const list=execFileSync("unzip",["-Z1",zip],{encoding:"utf8"}).trim().split("\n").filter(Boolean).sort(); const expected=["background.js","fonts/OFL.txt","fonts/inter-latin-wght-normal.woff2","icons/icon128.png","icons/icon16.png","icons/icon32.png","icons/icon48.png","images/hammer.png","manifest.json","popup.css","popup.html","popup.js"].sort(); const missing=expected.filter((name)=>!list.includes(name)); const extra=list.filter((name)=>!expected.includes(name)); if(missing.length||extra.length){ console.error("Unexpected zip contents"); if(missing.length) console.error("missing:", missing.join(", ")); if(extra.length) console.error("extra:", extra.join(", ")); process.exit(1);} '
	@echo "Built $(ZIP)"

clean:
	rm -rf "$(DIST)"
