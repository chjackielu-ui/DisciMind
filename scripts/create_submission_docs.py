from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "submission_materials"
OUT.mkdir(exist_ok=True)

NAVY = "0B2545"
BLUE = "2E74B5"
MID = "1F4D78"
GRAY = "5B6573"
LIGHT = "E8EEF5"
PALE = "F4F6F9"
GREEN = "1F6B4F"
RED = "9B1C1C"

def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tcPr.append(shd)
    shd.set(qn('w:fill'), fill)

def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar')
        tcPr.append(tcMar)
    for m, v in [('top', top), ('start', start), ('bottom', bottom), ('end', end)]:
        node = tcMar.find(qn(f'w:{m}'))
        if node is None:
            node = OxmlElement(f'w:{m}')
            tcMar.append(node)
        node.set(qn('w:w'), str(v))
        node.set(qn('w:type'), 'dxa')

def set_table_borders(table, color="B8C4D1", sz="6"):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = tblPr.first_child_found_in('w:tblBorders')
    if borders is None:
        borders = OxmlElement('w:tblBorders')
        tblPr.append(borders)
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        tag = qn(f'w:{edge}')
        el = borders.find(tag)
        if el is None:
            el = OxmlElement(f'w:{edge}')
            borders.append(el)
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), sz)
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), color)

def set_row_pagination(row, repeat_header=False):
    trPr = row._tr.get_or_add_trPr()
    if repeat_header:
        header = OxmlElement('w:tblHeader')
        header.set(qn('w:val'), 'true')
        trPr.append(header)
    cant = OxmlElement('w:cantSplit')
    trPr.append(cant)

def set_table_widths(table, widths):
    table.autofit = False
    tblPr = table._tbl.tblPr
    tblW = tblPr.first_child_found_in('w:tblW')
    if tblW is None:
        tblW = OxmlElement('w:tblW')
        tblPr.append(tblW)
    total = sum(widths)
    tblW.set(qn('w:w'), str(total))
    tblW.set(qn('w:type'), 'dxa')
    tblInd = tblPr.first_child_found_in('w:tblInd')
    if tblInd is None:
        tblInd = OxmlElement('w:tblInd')
        tblPr.append(tblInd)
    tblInd.set(qn('w:w'), '120')
    tblInd.set(qn('w:type'), 'dxa')
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for w in widths:
        col = OxmlElement('w:gridCol')
        col.set(qn('w:w'), str(w))
        grid.append(col)
    for row in table.rows:
        for i, cell in enumerate(row.cells):
            tcPr = cell._tc.get_or_add_tcPr()
            tcW = tcPr.first_child_found_in('w:tcW')
            if tcW is None:
                tcW = OxmlElement('w:tcW')
                tcPr.append(tcW)
            tcW.set(qn('w:w'), str(widths[i]))
            tcW.set(qn('w:type'), 'dxa')
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    if table.rows:
        set_row_pagination(table.rows[0], repeat_header=True)
        for row in table.rows[1:]:
            set_row_pagination(row)

def set_run(run, size=11, bold=False, color="000000", italic=False):
    run.font.name = 'Microsoft YaHei'
    run._element.rPr.rFonts.set(qn('w:ascii'), 'Microsoft YaHei')
    run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Microsoft YaHei')
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)

def set_para(p, before=0, after=6, line=1.10, align=None):
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if align is not None:
        p.alignment = align

def configure_doc(doc, short_title):
    sec = doc.sections[0]
    sec.top_margin = Inches(0.75)
    sec.bottom_margin = Inches(0.75)
    sec.left_margin = Inches(0.85)
    sec.right_margin = Inches(0.85)
    sec.header_distance = Inches(0.35)
    sec.footer_distance = Inches(0.35)
    normal = doc.styles['Normal']
    normal.font.name = 'Microsoft YaHei'
    normal._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor(0,0,0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.10
    for name, size, color, before, after in [
        ('Heading 1', 16, BLUE, 16, 8), ('Heading 2', 13, BLUE, 12, 6), ('Heading 3', 11.5, MID, 8, 4)]:
        st = doc.styles[name]
        st.font.name = 'Microsoft YaHei'
        st._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
        st.font.size = Pt(size); st.font.bold = True; st.font.color.rgb = RGBColor.from_string(color)
        st.paragraph_format.space_before = Pt(before); st.paragraph_format.space_after = Pt(after)
        st.paragraph_format.keep_with_next = True
    header = sec.header.paragraphs[0]
    header.text = ''
    set_para(header, after=0)
    hr = header.add_run(f"揭榜挂帅 XH-202620 | {short_title}")
    set_run(hr, size=8.5, color=GRAY)
    footer = sec.footer.paragraphs[0]
    footer.text = ''
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = footer.add_run('学研智擎 DisciMind  |  参赛材料')
    set_run(fr, size=8.5, color=GRAY)

def add_title(doc, title, subtitle=None):
    p = doc.add_paragraph()
    set_para(p, before=4, after=4, line=1.0, align=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run(title); set_run(r, size=22, bold=True, color=NAVY)
    if subtitle:
        p2 = doc.add_paragraph(); set_para(p2, after=14, line=1.0, align=WD_ALIGN_PARAGRAPH.CENTER)
        r2 = p2.add_run(subtitle); set_run(r2, size=11.5, color=GRAY)

def add_kicker(doc, text):
    p = doc.add_paragraph(); set_para(p, after=2, line=1.0, align=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run(text.upper()); set_run(r, size=9, bold=True, color=BLUE)

def add_para(doc, text, bold_prefix=None, color='000000', align=None):
    p = doc.add_paragraph(); set_para(p, align=align)
    if bold_prefix and text.startswith(bold_prefix):
        r = p.add_run(bold_prefix); set_run(r, bold=True, color=NAVY)
        r2 = p.add_run(text[len(bold_prefix):]); set_run(r2, color=color)
    else:
        r = p.add_run(text); set_run(r, color=color)
    return p

def add_bullets(doc, items, numbered=False):
    style = 'List Number' if numbered else 'List Bullet'
    for item in items:
        p = doc.add_paragraph(style=style); set_para(p, after=4, line=1.10)
        r = p.add_run(item); set_run(r)

def add_table(doc, headers, rows, widths=None, header_fill=LIGHT, font_size=9.3):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.style = 'Table Grid'
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        set_cell_shading(hdr[i], header_fill)
        p = hdr[i].paragraphs[0]; set_para(p, after=0, line=1.0)
        r = p.add_run(str(h)); set_run(r, size=font_size, bold=True, color=NAVY)
    for row in rows:
        cells = table.add_row().cells
        for i, val in enumerate(row):
            p = cells[i].paragraphs[0]; set_para(p, after=0, line=1.05)
            r = p.add_run(str(val)); set_run(r, size=font_size)
    if widths:
        set_table_widths(table, widths)
    else:
        set_table_widths(table, [9360 // len(headers)] * len(headers))
    set_table_borders(table)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table

def add_note(doc, label, text, fill=PALE, color=NAVY):
    table = doc.add_table(rows=1, cols=1); table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.cell(0,0); set_cell_shading(cell, fill); set_cell_margins(cell, top=120,bottom=120,start=160,end=160)
    p = cell.paragraphs[0]; set_para(p, after=0, line=1.10)
    r = p.add_run(label + '：'); set_run(r, bold=True, color=color)
    r2 = p.add_run(text); set_run(r2, color='333333')
    set_table_widths(table, [9360]); set_table_borders(table, color='D7DEE8', sz='4')
    doc.add_paragraph().paragraph_format.space_after = Pt(1)

def add_signature(doc, labels):
    rows = [[x, '____________________________', '日期：____年__月__日'] for x in labels]
    add_table(doc, ['签署主体', '签字/盖章', '日期'], rows, widths=[2200, 4300, 2860], font_size=9.5)

def save(doc, filename):
    path = OUT / filename
    doc.core_properties.author = 'DisciMind 项目组'
    doc.core_properties.title = filename.replace('.docx','')
    doc.core_properties.subject = '揭榜挂帅 XH-202620 参赛材料'
    doc.save(path)
    return path

def build_index():
    d=Document(); configure_doc(d,'提交材料总目录'); add_kicker(d,'Submission package'); add_title(d,'揭榜挂帅参赛材料总目录','XH-202620——面向一流学科建设的学科垂类大模型与创新应用开发比赛')
    add_note(d,'作品名称','学研智擎 DisciMind——面向一流学科建设的垂类大模型教学科研创新应用平台。')
    add_para(d,'本目录将报名要求对应到可提交文件、仓库路径和待补充事项。文件中的“待填写/待签字”字段请在提交前由团队据实补齐。')
    add_table(d,['编号','材料文件','用途与对应要求','状态'],[
        ['02','02-伦理与安全合规性声明.docx / .pdf','数据脱敏、学术伦理、AI生成标识、签字/盖章','已生成，待签署'],
        ['03','03-作品Demo体验与文档说明.docx','体验地址、部署步骤、账号、演示流程、3分钟视频信息','已生成，视频/公网地址待补'],
        ['05','05-作品代码与模型复现说明.docx','源码、模型配置、ServiceID、数据、环境、复现步骤','已生成，ServiceID按实际配置填写'],
        ['06','06-效果验证报告.docx','两名目标用户结构化试用记录、量化证据、视频脚本','已生成，用户签字/视频待补'],
        ['07','07-其他辅助材料清单.docx','测试脚本、报告、截图、数据与知识产权材料索引','已生成，按需附证'],
    ], widths=[700,2700,4300,1660])
    d.add_heading('提交前总核对', level=1)
    add_bullets(d,[
        '02声明由团队负责人签字或团队盖章；两名目标用户在06报告的试用记录上签字确认。',
        '03补填公网Demo地址（如报名系统需要）和3分钟以内交互演示视频链接；当前仓库提供本地自部署入口。',
        '05仅提交脱敏源码、公开数据与配置模板，不提交真实API Key、生产数据库、用户上传文件或运行缓存。',
        '06不得用自动化测试冒充真人反馈；团队应让两名目标用户实际试用后补填日期、具体意见和签字。',
        '同步提交报名系统审核通过的报名表，并逐项核对队伍、作品、联系人和知识产权信息一致。'
    ])
    add_para(d,'建议打包目录：将以上文件放入 submission_materials/，与项目源码根目录、release/评委包、视频文件或视频链接说明一并提交。')
    add_signature(d,['团队负责人'])
    return save(d,'00-参赛材料总目录.docx')

def build_compliance():
    d=Document(); configure_doc(d,'02 伦理与安全合规性声明'); add_kicker(d,'02 | Compliance statement'); add_title(d,'伦理与安全合规性声明','适用于“学研智擎 DisciMind”参赛作品')
    add_table(d,['项目字段','填写内容'],[
        ['赛事名称','揭榜挂帅——XH-202620-面向一流学科建设的学科垂类大模型与创新应用开发比赛'],
        ['作品名称','学研智擎 DisciMind——面向一流学科建设的垂类大模型教学科研创新应用平台'],
        ['参赛团队','____________________________'],['团队负责人','____________________________'],['提交日期','____年__月__日']], widths=[2400,6960], font_size=10)
    d.add_heading('一、合规承诺', level=1)
    add_para(d,'本团队郑重承诺：参赛作品在数据采集、训练/检索、模型调用、内容生成、展示、导出和演示过程中，遵守法律法规、学校管理制度、科研诚信与教育伦理要求，并对参赛作品及所提交材料的真实性、合法性和可追溯性负责。')
    rows=[
        ['1','不使用未经脱敏的真实个人数据','不将学生、患者、案件当事人或其他自然人的姓名、证件号、联系方式、精确定位、健康/学业隐私、案件材料等未经授权的敏感信息写入训练集、知识库、测试集、日志或提交包。确需使用的材料先取得合法授权并完成最小化、去标识化和访问控制；本提交包仅使用团队编写/合成的公开评测数据与脱敏演示数据。','承诺并已按提交包边界执行'],
        ['2','不生成或传播违反学术伦理的内容','系统不得用于伪造实验数据、篡改统计结果、编造参考文献、虚构实验过程、代写/代考或其他违反学术伦理与科研诚信的行为。对知识性回答保留来源和无来源提示，对教师教学材料设置人工审核后发布的门槛。','承诺；以系统权限、提示词、来源追溯和人工审核共同落实'],
        ['3','显著标识AI生成内容','对AI回答、AI题目、AI讲义、AI试卷、图表/学习卡片及其他可导出的生成内容，使用“AI生成”或等效显著标识，并在必要位置提示“仅供学习参考，请结合课程资料和教师意见判断”。生成结果保留模型/Provider及来源等可审计元数据。','承诺并已在产品与接口设计中设置'],
    ]
    add_table(d,['序号','承诺事项','具体执行措施','确认'],rows,widths=[650,1900,5200,1610],font_size=8.7)
    d.add_heading('二、作品内置安全与治理措施', level=1)
    add_bullets(d,[
        '身份与权限：JWT认证、学生/教师/管理员角色边界、课程/教学班/知识库所有权校验在后端重复执行；教师只能使用授权的聚合学情数据，不能查看学生学科答疑原文。',
        '数据与密钥：API Key仅保存在后端运行环境或加密配置表，不进入前端产物和提交包；评委包排除真实.env、生产数据库、上传文件、日志与运行缓存。',
        '模型与来源：RAG回答保存文件名、页码/位置、片段、相似度和知识库信息；没有可靠来源时明确提示“该回答未基于知识库”，不得编造引用。',
        '工具与执行：Tool Registry不提供任意Shell、SQL、任意URL抓取或直接代码执行；C/Python代码仅经Judge0隔离沙箱执行；高风险写文件工具要求显式确认并限制格式、大小和路径。',
        '人工复核：教师生成的教案、试卷、作业、PPT大纲等材料在发布前必须由教师审核编辑；学生和教师可查看执行轨迹、来源和生成状态。',
        '标识与提示：学生AI对话、练习题标签、成果卡片和安全免责声明均保留AI生成提示；模型未配置时不伪造模型回答，功能返回明确的未配置状态。'
    ])
    d.add_heading('三、实现依据与可核查位置', level=1)
    add_table(d,['依据/模块','仓库位置','可核查内容'],[
        ['AI免责声明与生成标识','docs/DisciMind API 接口文档 v1.0.md；frontend/src/components/practice/practice-tags.js','安全免责声明接口、AI生成标签、is_ai_generated等字段约定'],
        ['AI安全治理','backend/src/services/admin-ai-safety.service.js；backend/src/services/student-chat.service.js','敏感信息、来源、人工复核、模型信息、教育场景风险控制'],
        ['权限与数据边界','docs/多智能体源码与运行说明.md；backend/src/modules/agent-chat/agent-context.service.js','角色/所有权校验、知识库授权、Tool风险边界'],
        ['脱敏数据与提交包','datasets/；backend/prisma/seed-judge-demo.js；scripts/judge-package/Build-Judge-Package.ps1','公开/合成数据、幂等演示种子、敏感文件排除规则'],
    ], widths=[2300,3800,3260], font_size=8.8)
    d.add_heading('四、签署确认', level=1)
    add_para(d,'团队确认以上承诺真实、完整、有效；如参赛作品、数据或部署环境发生变化，团队将同步更新本声明并重新自查。')
    add_signature(d,['团队负责人签字','团队盖章（如有）'])
    return save(d,'02-伦理与安全合规性声明.docx')

def build_demo():
    d=Document(); configure_doc(d,'03 作品Demo'); add_kicker(d,'03 | Demo'); add_title(d,'作品Demo体验与文档说明','学研智擎 DisciMind')
    add_note(d,'Demo定位','本项目支持评委本地一键部署，也可由参赛团队自行部署公网演示环境。当前仓库未内置公网服务，因此公网地址字段需由团队按实际部署补填。')
    add_table(d,['项目','内容'],[
        ['本地体验地址','http://127.0.0.1:5173/（执行一键部署.bat、一键启动.bat后访问）'],
        ['公网体验地址（如需）','待团队补填：____________________________________________'],
        ['演示账号','管理员 admin_demo / 123456；教师 teacher_demo / 123456；学生 student_demo / 123456'],
        ['代码与运行说明','README.md；评委必读.md；docs/评委本地运行说明.md；docs/运行说明.md'],
        ['演示视频','待录制并补填链接/附件名：________________________________'],
    ], widths=[2400,6960], font_size=9.5)
    d.add_heading('一、评委本地运行', level=1)
    add_bullets(d,[
        '将项目完整解压到本地磁盘，不能直接在ZIP压缩包内运行。',
        '双击根目录“一键部署.bat”，脚本准备便携Node.js 22、MariaDB 11.4、前后端依赖、迁移和演示数据。首次部署需要稳定网络和至少4GB可用磁盘。',
        '双击“一键启动.bat”，脚本启动数据库、后端和前端并自动打开浏览器；访问http://127.0.0.1:5173/。',
        '需要C/Python在线编译器时，提前启动Docker Desktop（Linux containers）；未安装Docker时，其他核心平台仍可演示。',
        '演示结束双击“一键停止.bat”；演示数据库保留，可下次继续体验。'
    ],numbered=True)
    d.add_heading('二、建议体验路线', level=1)
    add_table(d,['角色','建议路线','展示重点'],[
        ['学生','登录→课程学习→AI学科答疑→知识库来源→错题/学习画像→自定义学习流→在线编译器','个性化学习、来源追溯、多智能体执行、结果回写'],
        ['教师','登录→课程/教学班→学情看板→教师AI→备课生成→审核编辑→发布/导出','聚合学情、教师多Agent协作、人工审核门槛'],
        ['管理员','登录→用户与权限→AI配置→知识/智能体审核→日志/治理','角色治理、审核闭环、密钥脱敏、风险提示'],
    ], widths=[1200,4600,3560], font_size=9)
    d.add_heading('三、3分钟交互演示视频脚本（非PPT/非单纯配音录屏）', level=1)
    add_table(d,['时间','交互动作','画面与讲解要点'],[
        ['0:00-0:20','打开登录页并以学生账号登录','展示作品名、角色入口和AI生成提示；说明数据为脱敏/演示数据。'],
        ['0:20-1:00','进入课程与AI学科答疑，输入“解释逻辑回归”','展示流式回答、AI生成标识、5条知识库来源和引用联动。'],
        ['1:00-1:40','打开错题/学习画像并启动学习流','展示掌握度图表、错题诊断、节点执行进度和刷新恢复。'],
        ['1:40-2:20','切换教师账号，选择课程/教学班生成备课材料','展示班级聚合指标、教学目标/重难点/测试草稿，明确“教师审核后发布”。'],
        ['2:20-2:50','切换管理员或打开治理页面','展示AI配置脱敏、知识/Agent审核和操作日志。'],
        ['2:50-3:00','回到首页或成果中心','展示生成成果的AI标识、来源/元数据和下载入口；结束。'],
    ], widths=[1300,3400,4660], font_size=8.8)
    add_note(d,'视频提交要求','视频时长控制在3分钟以内，必须清晰展示从任务输入到结果输出的完整运行流程，突出实际响应与处理能力。请在提交前补填视频文件名、网盘/平台链接、访问密码（如有）和校验值。',fill='FFF8E8',color='7A5A00')
    d.add_heading('四、已知边界与故障处理', level=1)
    add_bullets(d,[
        '源码包不内置第三方AI密钥；未配置模型时，课程、题目、学情、权限、治理和PPT演示模式仍可运行，依赖模型的入口会返回明确未配置状态。',
        '在线编译器依赖Docker和Judge0；评委可先体验核心教学/科研闭环，再按需启用编译器。',
        '服务日志位于.judge-runtime/logs；端口冲突、依赖下载和数据库问题按docs/评委本地运行说明.md排查。'
    ])
    return save(d,'03-作品Demo体验与文档说明.docx')

def build_code():
    d=Document(); configure_doc(d,'05 作品代码'); add_kicker(d,'05 | Code & reproducibility'); add_title(d,'作品代码、模型与可复现说明','学研智擎 DisciMind')
    add_note(d,'提交原则','提交包应确保评委可在常规Windows 10/11环境复现核心功能。源码、数据集和配置模板可公开；真实API Key、生产数据库、用户上传文件和运行缓存不得提交。')
    d.add_heading('一、代码结构与核心能力', level=1)
    add_table(d,['能力','主要路径','复现说明'],[
        ['前端三端与AI工作台','frontend/src/；frontend/package.json','Vite + 原生JavaScript ES Modules；学生、教师、管理员角色页面与AI交互'],
        ['后端API与数据层','backend/src/；backend/prisma/schema.prisma','Express 5、Prisma 7、MySQL；认证、课程、题目、画像、成果与治理'],
        ['统一多智能体编排','backend/src/modules/ai-assistant/','Planner→Skill/Agent→Tool/Knowledge→串/并行执行→Trace/成果持久化'],
        ['学习流与学习Agent','backend/src/modules/learning-agent/','学习节点、讲解、诊断、训练、学习数据回写与恢复'],
        ['知识库/RAG','backend/src/modules/knowledge-base/；backend/src/modules/agent-chat/','PDF/Word/Markdown解析、检索、来源、权限过滤和无来源提示'],
        ['在线编译器','deploy/judge0/；backend/src/','C/Python通过Judge0隔离执行；浏览器不直接访问Judge0'],
        ['测试与验收','backend/test/；frontend/test/；scripts/','后端专项/全量测试、前端构建、浏览器验收和评委包完整性检查'],
    ], widths=[2300,3700,3260], font_size=8.8)
    d.add_heading('二、模型与ServiceID配置', level=1)
    add_table(d,['字段','当前模板值/说明','提交时填写'],[
        ['模型Provider','阿里云百炼（OpenAI兼容接口/原生搜索能力按功能选择）','实际供应商：________________'],
        ['默认模型','qwen3.7-plus（见deploy/model/bailian.env.example）','实际模型：________________'],
        ['模型文件','本作品不分发第三方模型权重；使用合法在线Provider或参赛方自有部署','如有本地权重/文件，填写相对路径和SHA-256：________________'],
        ['模型ServiceID','如使用平台托管模型，请填写实际ServiceID；当前源码模板未固化团队私有ServiceID','ServiceID：________________'],
        ['Embedding/RAG','text-embedding-v4等配置为可选模板；知识库存储支持本地/数据库方案','实际Embedding模型/库：________________'],
        ['密钥','仅由后端环境变量或加密配置中心读取；提交包不含密钥值','部署时由评委/团队管理员自行配置'],
    ], widths=[2200,4700,2360], font_size=8.8)
    d.add_heading('三、数据集与种子数据', level=1)
    add_bullets(d,[
        'datasets/：multi-agent-evaluation.jsonl、knowledge-408.jsonl、compiler-cases.json等，均为团队编写或合成的公开评测数据，不含个人信息。',
        'backend/prisma/seed.js、backend/prisma/seed-judge-demo.js：幂等生成演示账号、课程、题目、学习记录和治理数据。',
        'backend/prisma/seed-assets/408-public-knowledge.md：公开知识库种子材料；上传文件目录仅作为运行时存储，不作为提交数据来源。'
    ])
    d.add_heading('四、复现步骤', level=1)
    add_bullets(d,[
        'Windows评委包：双击一键部署.bat，再双击一键启动.bat，访问http://127.0.0.1:5173/。',
        '手动开发环境：安装Node.js 22.12+、MySQL 8+/MariaDB 11.4；分别在backend和frontend执行npm install；配置backend/.env和frontend/.env。',
        '数据库：在backend执行npx prisma generate、npx prisma migrate deploy（开发时可按运行说明执行迁移），再运行node prisma/seed.js导入演示数据。',
        '模型：复制deploy/model/bailian.env.example到后端配置，填入合法密钥和模型参数；禁止将填充后的文件提交到仓库。',
        '验证：访问/api/health；使用admin_demo、teacher_demo、student_demo登录；按03 Demo路线完成课程、AI、学情、治理验收。',
        '打包：执行scripts/judge-package/Build-Judge-Package.ps1生成release ZIP及SHA-256校验文件。'
    ],numbered=True)
    d.add_heading('五、复现与安全检查清单', level=1)
    add_table(d,['检查项','提交前确认'],[
        ['源码完整性','frontend/、backend/、docs/、datasets/、deploy/、scripts/均已包含；锁文件可用'],
        ['迁移可用性','Prisma schema validate通过；迁移按顺序可执行；seed可重复运行'],
        ['密钥安全','git/压缩包中无真实.env、API Key、数据库导出、上传文件和日志'],
        ['模型诚实性','未配置模型时不伪造回答；ServiceID/权重信息按实际部署填写'],
        ['权限边界','学生/教师/管理员、知识库、课程、教学班和成果下载权限已验收'],
    ], widths=[2400,6960], font_size=9)
    d.add_heading('六、知识产权与第三方依赖声明', level=1)
    add_para(d,'团队确认对参赛作品代码、文档、演示数据和自行编写/合成的素材享有合法使用权或已取得必要授权；第三方开源依赖按其许可证使用，具体依赖版本见frontend/package.json、backend/package.json及锁文件。若存在第三方素材、字体、图片或模型服务，应在提交时附授权/许可证清单。')
    add_signature(d,['团队负责人'])
    return save(d,'05-作品代码与模型复现说明.docx')

def build_effect():
    d=Document(); configure_doc(d,'06 效果验证报告'); add_kicker(d,'06 | Effect validation'); add_title(d,'作品效果验证报告','学研智擎 DisciMind——目标用户试用与结构化测试记录')
    add_note(d,'报告边界','仓库已提供自动化、API、真实模型和浏览器验收证据；本报告不把自动化测试冒充真人反馈。两名目标用户的身份已按要求填写，团队需在真实试用后补齐日期、原始意见和签字。')
    d.add_heading('一、验证对象与方法', level=1)
    add_table(d,['目标用户','身份（按要求填写）','典型任务','记录方式'],[
        ['用户A（匿名编号 S-2024-SE-01）','2024级软件工程专业学生','课程学习、AI学科答疑、错题/画像、个性化学习流、代码练习','现场操作记录+访谈+签字'],
        ['用户B（匿名编号 T-ART-01）','艺术专业教师','课程资料问答、班级聚合学情、备课材料生成、人工审核与导出','现场操作记录+访谈+签字'],
    ], widths=[2100,2600,3000,1660], font_size=9)
    add_para(d,'建议在同一版本、同一演示数据库和相同网络条件下完成试用；记录开始/结束时间、模型配置状态、使用页面、输入任务、输出截图及用户主观评价。')
    d.add_heading('二、用户A结构化试用记录：2024级软件工程专业学生', level=1)
    add_table(d,['字段','填写内容'],[
        ['试用日期/地点','____年__月__日；地点/设备：________________'],
        ['试用版本','Git commit/压缩包版本：________________'],
        ['任务1：AI学科答疑','输入问题：解释逻辑回归；是否看到AI生成标识：□是 □否；是否看到来源：□是 □否；来源数量：____'],
        ['任务2：学习状态分析','是否读取本人掌握度/错题数据：□是 □否；图表/表格是否可理解：□是 □否；完成时间：____分钟'],
        ['任务3：启动学习流','计划名称：________________；首节点是否展示：□是 □否；刷新后是否恢复：□是 □否；完成时间：____分钟'],
        ['任务4：代码练习（可选）','语言：□C □Python；是否成功提交与返回结果：□是 □否；异常提示是否清晰：□是 □否'],
        ['用户反馈原话（请据实填写）','优点：____________________________________________________________\n改进建议：______________________________________________________'],
        ['用户确认','用户签字：________________；日期：____年__月__日'],
    ], widths=[2400,6960], font_size=9.2)
    d.add_heading('三、用户B结构化试用记录：艺术专业教师', level=1)
    add_table(d,['字段','填写内容'],[
        ['试用日期/地点','____年__月__日；地点/设备：________________'],
        ['试用版本','Git commit/压缩包版本：________________'],
        ['任务1：课程资料问答','输入问题/资料：________________；来源与引用是否可核验：□是 □否；满意度（1-5）：____'],
        ['任务2：班级学情分析','课程/教学班：________________；是否仅展示聚合数据：□是 □否；图表是否支持教学判断：□是 □否'],
        ['任务3：备课生成','艺术专业示例提示词：请根据本节《艺术概论/设计基础》教学目标，生成课堂导入、重点难点、讨论问题、实践活动和课后作业，并明确标注AI生成内容；教师可按实际课程修改提示词。\n生成目标/重难点/测试/作业：□完整 □部分；AI标识是否明显：□是 □否；教师审核后是否可编辑：□是 □否'],
        ['任务4：导出与发布','是否生成DOCX/PDF/XLSX等成果：□是 □否；发布前是否有审核门槛：□是 □否；完成时间：____分钟'],
        ['提示词修改与采纳记录','原始提示词：____________________________________________________\n教师修改后提示词：______________________________________________\n修改原因/采纳情况：______________________________________________'],
        ['用户反馈原话（请据实填写）','优点：____________________________________________________________\n改进建议：______________________________________________________'],
        ['用户确认','用户签字：________________；日期：____年__月__日'],
    ], widths=[2400,6960], font_size=9.2)
    d.add_heading('四、系统量化验证证据（项目组测试）', level=1)
    add_table(d,['指标/场景','结果','证据位置'],[
        ['AI助手专项','24/24通过；相关专项50/50；后端全量503/503；前端963 modules构建通过','docs/ai-assistant-test-report.md'],
        ['AI对话与卡片专项','22/22通过；后端479/479；真实Qwen学习分析约2.1秒；学习卡片5张','docs/ai-assistant-test-report.md；docs/learning-card-test-report.md'],
        ['知识库问答','逻辑回归问答4/4；返回5条真实来源；来源可展开并与回答联动','docs/ai-assistant-test-report.md'],
        ['AI搜索与引用','真实Qwen搜索10个来源；search.sources早于answer.delta；引用可观察','docs/ai-assistant-test-report.md'],
        ['试卷/成果生成','20题结构化试卷；DOCX下载HTTP 200、13,969 bytes、OpenXML签名通过','docs/ai-assistant-test-report.md'],
        ['学习流并发幂等','同一计划并发启动两次均HTTP 200，仅创建1个session；刷新恢复通过','docs/learning-start-test-report.md；artifacts/hardening/learning-flow-api-e2e.json'],
        ['浏览器多视口','1440×900、1024×768、390×844无横向溢出；应用Console 0 error；无未处理500','docs/ai-assistant-test-report.md；artifacts/cross-portal-rebuild/'],
        ['权限与安全','学生/教师能力裁剪、确认门禁、Tool参数/循环保护、串/并行Agent均有专项覆盖','backend/test/ai-assistant-hardening.test.js；docs/ai-assistant-test-report.md'],
    ], widths=[2200,4300,2860], font_size=8.6)
    add_note(d,'证据使用说明','以上为项目组可复核的系统测试结果，不替代两名真实目标用户的主观反馈。用户试用时可直接复用这些任务，并在表格中记录实际完成时间、输出质量和改进建议。',fill='FFF8E8',color='7A5A00')
    d.add_heading('五、结论与改进计划', level=1)
    add_para(d,'基于现有自动化、真实模型、API和浏览器证据，DisciMind已验证课程问答、来源追溯、学习画像、学习流、多智能体协同、教师聚合学情与成果生成等核心链路能够运行。最终提交结论应在两名目标用户完成现场试用并签字后更新。')
    add_bullets(d,[
        '短期：补齐两名用户的实际试用日期、设备、完成时间、原话反馈、截图/视频和签字；补填3分钟视频链接。',
        '中期：扩大不同课程与不同专业的样本，记录任务完成时间、错误率、引用核验率和教师采纳率；对异常数据保留原值并单独治理。',
        '持续：保持AI生成显著标识、来源/无来源提示、教师发布前审核和隐私最小化策略。'
    ])
    d.add_heading('六、附件索引', level=1)
    add_table(d,['附件','建议提交内容','当前仓库位置/状态'],[
        ['用户试用截图','学生和教师各至少1组，包含输入、处理过程、结果和AI标识','待团队现场补拍'],
        ['3分钟交互视频','非PPT、非单纯配音录屏；从任务输入到结果输出完整链路','待录制'],
        ['自动化/浏览器报告','测试报告、JSON、PNG截图','docs/、artifacts/，已存在'],
        ['用户签字页','两名目标用户与团队负责人签字','本报告表格，待签署'],
    ], widths=[1800,4300,3260], font_size=8.8)
    add_signature(d,['用户A（2024级软件工程专业学生）','用户B（艺术专业教师）','团队负责人'])
    return save(d,'06-效果验证报告.docx')

def build_other():
    d=Document(); configure_doc(d,'07 其他材料'); add_kicker(d,'07 | Supporting materials'); add_title(d,'其他辅助材料清单','学研智擎 DisciMind')
    add_para(d,'本清单用于辅助评审过程。提交时可将已有文件直接打包，或在对应行补充本轮测试产生的截图、视频、数据和报告。')
    add_table(d,['类别','材料/文件','用途与核验点','状态'],[
        ['测试脚本','backend/test/、frontend/test/、scripts/','后端专项/全量测试、前端契约、评委包部署与完整性检查','已包含'],
        ['测试报告','docs/ai-assistant-test-report.md；docs/learning-card-test-report.md；docs/learning-start-test-report.md','AI、学习卡片、学习流的量化结果与清理记录','已包含'],
        ['浏览器/界面证据','artifacts/cross-portal-rebuild/；artifacts/admin-recovery/','多角色、多分辨率界面截图、API和浏览器验收结果','已包含，可择优附上'],
        ['公开数据与知识材料','datasets/；backend/prisma/seed-assets/','脱敏/合成评测数据、公开知识库种子材料','已包含'],
        ['部署与运行环境','一键部署.bat；一键启动.bat；一键停止.bat；docs/评委本地运行说明.md','评委本地复现、服务启动停止和故障排查','已包含'],
        ['完整性校验','scripts/judge-package/Build-Judge-Package.ps1；release/中的ZIP与.sha256.txt','打包、文件清单和SHA-256校验','打包时生成'],
        ['演示视频','3分钟以内应用系统交互演示视频','验证输入→处理→输出完整运行流程','待录制'],
        ['用户反馈原始记录','06报告签字页、现场截图/访谈摘要','证明两名真实目标用户试用与使用价值','待团队完成'],
        ['知识产权/许可证','LICENSE；第三方依赖package.json/锁文件；素材授权清单','证明代码、数据、模型和素材无权利瑕疵','团队补充授权清单'],
    ], widths=[1700,3500,3300,860], font_size=8.5)
    d.add_heading('提交包敏感信息排除清单', level=1)
    add_bullets(d,[
        '不提交真实API Key、数据库密码、JWT密钥、AI_CONFIG_ENCRYPTION_KEY或其他凭据。',
        '不提交生产数据库导出、用户上传文件、未脱敏日志、浏览器缓存和.judge-runtime运行时数据。',
        '不提交未经授权的第三方论文全文、教材扫描件、图片、音视频或模型权重。',
        '不将测试脚本中的个人姓名、联系方式、真实学号、病历、案件编号等敏感信息带入公开材料。'
    ])
    d.add_heading('知识产权与原创性确认（团队填写）', level=1)
    add_table(d,['确认项','团队填写/勾选'],[
        ['代码权属','□团队原创/享有合法授权；说明：________________________________'],
        ['数据权属','□团队编写/合成或已获授权；说明：____________________________'],
        ['模型与服务','□使用合法Provider/ServiceID；权利与合规责任由团队承担'],
        ['第三方依赖','□已按许可证使用并保留NOTICE/许可证信息'],
        ['非雷同/非抄袭','□已完成原创性自查；如有相似开源组件已注明来源和改动'],
    ], widths=[2400,6960], font_size=9)
    add_note(d,'报名表一致性','请同步提交报名系统审核通过的参赛报名表，并逐项核对报名表中的团队、作品、联系人、指导教师、知识产权和联系方式与系统填报内容完全一致。',fill='FFF8E8',color='7A5A00')
    add_signature(d,['团队负责人'])
    return save(d,'07-其他辅助材料清单.docx')

if __name__ == '__main__':
    for f in OUT.glob('*.docx'):
        f.unlink()
    files = [build_index(), build_compliance(), build_demo(), build_code(), build_effect(), build_other()]
    print('\n'.join(str(x) for x in files))
