from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'submission_materials' / '02-伦理与安全合规性声明.pdf'
font_path = 'C:/Windows/Fonts/NotoSansSC-VF.ttf'
if not Path(font_path).exists():
    font_path = 'C:/Windows/Fonts/simsun.ttc'
pdfmetrics.registerFont(TTFont('CJK', font_path))
NAVY = colors.HexColor('#0B2545')
BLUE = colors.HexColor('#2E74B5')
GRAY = colors.HexColor('#5B6573')
LIGHT = colors.HexColor('#E8EEF5')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleCJK', fontName='CJK', fontSize=20, leading=26, alignment=TA_CENTER, textColor=NAVY, spaceAfter=4))
styles.add(ParagraphStyle(name='SubCJK', fontName='CJK', fontSize=10.5, leading=15, alignment=TA_CENTER, textColor=GRAY, spaceAfter=12))
styles.add(ParagraphStyle(name='KickerCJK', fontName='CJK', fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=BLUE, spaceAfter=3))
styles.add(ParagraphStyle(name='H1CJK', fontName='CJK', fontSize=14, leading=19, textColor=BLUE, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name='BodyCJK', fontName='CJK', fontSize=9.4, leading=15, textColor=colors.black, spaceAfter=5))
styles.add(ParagraphStyle(name='CellCJK', fontName='CJK', fontSize=7.5, leading=10.2, textColor=colors.black))
styles.add(ParagraphStyle(name='CellHeadCJK', fontName='CJK', fontSize=7.7, leading=10.2, textColor=NAVY))

def para(text, style='BodyCJK'):
    return Paragraph(str(text).replace('\n', '<br/>'), styles[style])

def make_table(rows, widths):
    t = Table(rows, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('GRID', (0,0), (-1,-1), 0.35, colors.HexColor('#B8C4D1')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 5), ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('BACKGROUND', (0,0), (-1,0), LIGHT),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('CJK', 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawString(18*mm, 11*mm, '揭榜挂帅 XH-202620 | 学研智擎 DisciMind | 伦理与安全合规性声明')
    canvas.drawRightString(A4[0]-18*mm, 11*mm, f'第 {doc.page} 页')
    canvas.restoreState()

story = [para('02 | COMPLIANCE STATEMENT', 'KickerCJK'), para('伦理与安全合规性声明', 'TitleCJK'), para('适用于“学研智擎 DisciMind”参赛作品', 'SubCJK')]
story.append(make_table([
    [para('项目字段','CellHeadCJK'), para('填写内容','CellHeadCJK')],
    [para('赛事名称','CellCJK'), para('揭榜挂帅——XH-202620-面向一流学科建设的学科垂类大模型与创新应用开发比赛','CellCJK')],
    [para('作品名称','CellCJK'), para('学研智擎 DisciMind——面向一流学科建设的垂类大模型教学科研创新应用平台','CellCJK')],
    [para('参赛团队','CellCJK'), para('____________________________','CellCJK')],
    [para('团队负责人','CellCJK'), para('____________________________','CellCJK')],
    [para('提交日期','CellCJK'), para('____年__月__日','CellCJK')]], [35*mm, 139*mm]))
story += [para('一、合规承诺','H1CJK'), para('本团队郑重承诺：参赛作品在数据采集、训练/检索、模型调用、内容生成、展示、导出和演示过程中，遵守法律法规、学校管理制度、科研诚信与教育伦理要求，并对参赛作品及所提交材料的真实性、合法性和可追溯性负责。')]
story.append(make_table([
    [para('序号','CellHeadCJK'), para('承诺事项','CellHeadCJK'), para('具体执行措施','CellHeadCJK'), para('确认','CellHeadCJK')],
    [para('1','CellCJK'), para('不使用未经脱敏的真实个人数据','CellCJK'), para('不将学生、患者、案件当事人或其他自然人的姓名、证件号、联系方式、精确定位、健康/学业隐私、案件材料等未经授权的敏感信息写入训练集、知识库、测试集、日志或提交包。确需使用的材料先取得合法授权并完成最小化、去标识化和访问控制；本提交包仅使用团队编写/合成的公开评测数据与脱敏演示数据。','CellCJK'), para('承诺并已按提交包边界执行','CellCJK')],
    [para('2','CellCJK'), para('不生成或传播违反学术伦理的内容','CellCJK'), para('系统不得用于伪造实验数据、篡改统计结果、编造参考文献、虚构实验过程、代写/代考或其他违反学术伦理与科研诚信的行为。对知识性回答保留来源和无来源提示，对教师教学材料设置人工审核后发布的门槛。','CellCJK'), para('承诺；以系统权限、提示词、来源追溯和人工审核共同落实','CellCJK')],
    [para('3','CellCJK'), para('显著标识AI生成内容','CellCJK'), para('对AI回答、AI题目、AI讲义、AI试卷、图表/学习卡片及其他可导出的生成内容，使用“AI生成”或等效显著标识，并在必要位置提示“仅供学习参考，请结合课程资料和教师意见判断”。生成结果保留模型/Provider及来源等可审计元数据。','CellCJK'), para('承诺并已在产品与接口设计中设置','CellCJK')]], [10*mm, 35*mm, 105*mm, 24*mm]))
story.append(para('二、作品内置安全与治理措施','H1CJK'))
for item in [
    '<b>身份与权限：</b>JWT认证、学生/教师/管理员角色边界、课程/教学班/知识库所有权校验在后端重复执行；教师只能使用授权的聚合学情数据，不能查看学生学科答疑原文。',
    '<b>数据与密钥：</b>API Key仅保存在后端运行环境或加密配置表，不进入前端产物和提交包；评委包排除真实.env、生产数据库、上传文件、日志与运行缓存。',
    '<b>模型与来源：</b>RAG回答保存文件名、页码/位置、片段、相似度和知识库信息；没有可靠来源时明确提示“该回答未基于知识库”，不得编造引用。',
    '<b>工具与执行：</b>Tool Registry不提供任意Shell、SQL、任意URL抓取或直接代码执行；C/Python代码仅经Judge0隔离沙箱执行；高风险写文件工具要求显式确认并限制格式、大小和路径。',
    '<b>人工复核：</b>教师生成的教案、试卷、作业、PPT大纲等材料在发布前必须由教师审核编辑；学生和教师可查看执行轨迹、来源和生成状态。',
    '<b>标识与提示：</b>学生AI对话、练习题标签、成果卡片和安全免责声明均保留AI生成提示；模型未配置时不伪造模型回答，功能返回明确的未配置状态。']:
    story.append(para('• ' + item))
story += [para('三、实现依据与可核查位置','H1CJK')]
story.append(make_table([
    [para('依据/模块','CellHeadCJK'), para('仓库位置','CellHeadCJK'), para('可核查内容','CellHeadCJK')],
    [para('AI免责声明与生成标识','CellCJK'), para('docs/DisciMind API 接口文档 v1.0.md；frontend/src/components/practice/practice-tags.js','CellCJK'), para('安全免责声明接口、AI生成标签、is_ai_generated等字段约定','CellCJK')],
    [para('AI安全治理','CellCJK'), para('backend/src/services/admin-ai-safety.service.js；backend/src/services/student-chat.service.js','CellCJK'), para('敏感信息、来源、人工复核、模型信息、教育场景风险控制','CellCJK')],
    [para('权限与数据边界','CellCJK'), para('docs/多智能体源码与运行说明.md；backend/src/modules/agent-chat/agent-context.service.js','CellCJK'), para('角色/所有权校验、知识库授权、Tool风险边界','CellCJK')],
    [para('脱敏数据与提交包','CellCJK'), para('datasets/；backend/prisma/seed-judge-demo.js；scripts/judge-package/Build-Judge-Package.ps1','CellCJK'), para('公开/合成数据、幂等演示种子、敏感文件排除规则','CellCJK')]], [33*mm, 75*mm, 66*mm]))
story += [para('四、签署确认','H1CJK'), para('团队确认以上承诺真实、完整、有效；如参赛作品、数据或部署环境发生变化，团队将同步更新本声明并重新自查。')]
story.append(make_table([
    [para('签署主体','CellHeadCJK'), para('签字/盖章','CellHeadCJK'), para('日期','CellHeadCJK')],
    [para('团队负责人签字','CellCJK'), para('____________________________','CellCJK'), para('____年__月__日','CellCJK')],
    [para('团队盖章（如有）','CellCJK'), para('____________________________','CellCJK'), para('____年__月__日','CellCJK')]], [40*mm, 85*mm, 39*mm]))
doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=17*mm, bottomMargin=18*mm)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
