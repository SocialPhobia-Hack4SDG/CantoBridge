# 日常人物头像生成记录

基础男性头像换成白底，原图原样保存为 male-sage.png 进入商城。male.png 使用内置 image_gen 编辑，最终提示词：

Use case: precise-object-edit. Edit the provided existing illustrated CantoBridge avatar. Change ONLY the sage green background to plain white (#ffffff), retaining a very subtle paper texture if needed. Preserve the exact person, face, hair, expression, dark outlines, ivory white shirt, illustration style, portrait scale, composition and circular crop safe margins. No text, no frame, no badge. Production free avatar replacement.

内置 image_gen 工具生成，最终资源保存于本目录：male.png、female.png、star.png、fox.png、jade.png。原图缩放到 512×512 以减少加载体积。neutral.svg 恢复灰色无脸人影，male.png 保留奶油白上衣，female.png 编辑为奶油白上衣。

## 免费头像衣服颜色调整

female.png 编辑目标为原绿色上衣头像，使用内置 image_gen，最终提示词：

Use case: precise-object-edit. Edit this existing CantoBridge profile avatar. Change ONLY the sage-green shirt into a plain warm white / ivory white shirt, matching the warm cream white clothing of the other free avatar. Keep the same person, exact face, hair, smile, crop, cream background, simple flat illustration, dark outlines and gentle paper texture completely unchanged. No text, no badge, no border. This is a production replacement avatar.

## male / star / fox / jade 共用提示词

Use case: illustration-story. Asset type: one square profile avatar for CantoBridge, a friendly Cantonese conversation community. Create ONE head and shoulders portrait: [subject]. Cohesive simple flat editorial illustration, warm approachable ordinary person, rounded shapes, few clean dark-green outlines, subtle paper texture, natural small smile, simple dot/almond eyes, no glamorous beauty styling. Cream and muted sage palette with terracotta accents. Centered head with generous circular-crop safe space, shoulders bottom. No text, no badges, no borders, no anime, no fantasy, no animal ears, no jewelry. Output final image and save local file.

Subject:

- male: young adult with short dark hair, simple cream shirt, sage green backdrop
- star: young adult with short curly hair and round glasses, ochre cardigan, pale cream backdrop
- fox: young adult with a dark ponytail, terracotta sweatshirt, pale peach backdrop
- jade: young adult with soft side-parted hair, forest-green everyday jacket, pale sage backdrop

## female 最终提示词

Use case: illustration-story. ONE square head-and-shoulders avatar for CantoBridge friendly Cantonese conversation community. Young adult with chin-length dark brown bob hair, simple sage green shirt, solid cream backdrop. Warm simple flat editorial illustration, rounded shapes, clean dark green outlines, subtle paper texture, natural small smile, simple eyes. Centered with generous circular crop safe space. Cream muted sage terracotta palette. No anime, no beauty glamour, no fantasy, no jewelry, no text, no watermark, no frame.
