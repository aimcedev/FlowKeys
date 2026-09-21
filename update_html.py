import re
import sys

def modify_html(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update Master Clock
    content = re.sub(r'id="master-bpm" value="\d+"', 'id="master-bpm" value="31"', content)
    content = re.sub(r'<option value="sync" selected>Sync</option>\s*<option value="trigger">Trigger</option>', 
                     '<option value="sync">Sync</option>\n              <option value="trigger" selected>Trigger</option>', content)

    # 2. Add active class to modules
    content = re.sub(r'class="module-card ([^"]+)"', r'class="module-card \1 active"', content)
    # Restore pass-through modules incorrectly caught? Wait, class="pass-through-panel" not module-card.
    content = content.replace(' active active"', ' active"')

    # 3. Add checked to all toggles
    content = re.sub(r'<input type="checkbox" id="toggle-(.*?)"( checked)?>', r'<input type="checkbox" id="toggle-\1" checked>', content)

    # 4. Bass values
    content = re.sub(r'id="in-max-bass" value="[A-Z]#?\d+"', 'id="in-max-bass" value="C#3"', content)
    content = re.sub(r'id="out-min-bass" value="[A-Z]#?\d+"', 'id="out-min-bass" value="E3"', content)
    content = re.sub(r'id="out-max-bass" value="[A-Z]#?\d+"', 'id="out-max-bass" value="E4"', content)

    # 5. Arp notes
    content = re.sub(r'<option value="2" selected>Top 2</option>\s*<option value="3">Top 3</option>', 
                     '<option value="2">Top 2</option>\n              <option value="3" selected>Top 3</option>', content)

    # 6. Shaker Note
    content = re.sub(r'id="note-shaker" value="\d+"', 'id="note-shaker" value="55"', content)

    # 7. Move Pad module after Arp module
    # Extract Pad module
    pad_match = re.search(r'(<!-- Pad Module -->.*?</div>\s*</div>)', content, flags=re.DOTALL)
    if pad_match:
        pad_html = pad_match.group(1)
        # Remove pad module from current location
        content = content.replace(pad_html, '')
        
        # Find end of Arp module
        arp_end_pattern = r'<div id="seq-arp"[^>]*></div>\s*</div>'
        arp_match = re.search(arp_end_pattern, content)
        
        if arp_match:
            insert_pos = arp_match.end()
            content = content[:insert_pos] + '\n\n        ' + pad_html + content[insert_pos:]

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print("Updated index.html successfully.")

if __name__ == '__main__':
    modify_html(sys.argv[1])
