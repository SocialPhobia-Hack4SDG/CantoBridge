# 话题卡粤拼维护

现有 472 张话题卡的 `jyutping` 字段在制作阶段由 ToJyutping 3.2.0 生成，已与后端卡池同步。网站运行不需要 Python、额外浏览器依赖或在线读音服务。

来源：[CanCLID ToJyutping](https://github.com/CanCLID/ToJyutping)，BSD 2-Clause，许可见 `ToJyutping-LICENSE.txt`。

重建方法：

```powershell
python -m pip install --target .run/jyutping-deps ToJyutping==3.2.0
python frontend/tools/generate-jyutping.py
```

脚本会检查未识别汉字并拒绝生成不完整读音。固定卡片可直接校对；需要长期保留的人工纠音请加入脚本的 `OVERRIDES`。自动标注未替代逐句语言审核，新增多音字、专有名词或口语变调内容时应校对后发布。

`jyutping` 仅标注问题中的粤语，英文品牌及标点保留。数字 1–6 是粤拼声调；不使用普通话拼音。当前产品要求仅展示问句读音，例句三语字段继续保持原结构。
