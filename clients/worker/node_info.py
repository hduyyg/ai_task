from dataclasses import dataclass, field
from typing import List, Optional, Any, Literal
from enum import Enum


@dataclass
class FieldChoice:
    """单选字段的选项"""
    label: str      # 显示文本
    value: str      # 实际值
    
    def to_dict(self) -> dict:
        return {"label": self.label, "value": self.value}


@dataclass
class TableValue:
    """表格类型字段的值"""
    headers: List[str]           # 表格标题列表
    rows: List[List[Any]]        # 表格数据行，每行是一个列表
    
    def to_dict(self) -> dict:
        return {"headers": self.headers, "rows": self.rows}


@dataclass
class LinkItem:
    """链接项"""
    label: str      # 显示文本
    url: str        # 链接地址
    
    def to_dict(self) -> dict:
        return {"label": self.label, "url": self.url}


@dataclass
class NodeField:
    """节点字段定义"""
    key: str                                    # 字段键名
    value: Any                                  # 字段值（table类型时应为TableValue，link类型时为URL字符串，link_list类型时为List[LinkItem]）
    field_type: Literal["text", "number", "textarea", "select", "table", "link", "link_list"]  # 字段类型
    label: Optional[str] = None                 # 显示标签，默认使用 key
    choices: Optional[List[FieldChoice]] = None # 单选类型的选项列表
    required: bool = False                      # 是否必填
    
    def to_dict(self) -> dict:
        result = {
            "key": self.key,
            "fieldType": self.field_type,
            "label": self.label or self.key,
            "required": self.required,
        }
        # 处理表格类型的值序列化
        if self.field_type == "table" and isinstance(self.value, TableValue):
            result["value"] = self.value.to_dict()
        # 处理链接列表类型的值序列化
        elif self.field_type == "link_list" and isinstance(self.value, list):
            result["value"] = [item.to_dict() if isinstance(item, LinkItem) else item for item in self.value]
        else:
            result["value"] = self.value
        if self.choices:
            result["choices"] = [c.to_dict() for c in self.choices]
        return result


@dataclass
class FlowNode:
    """React Flow 节点定义（dagre 自动布局）"""
    id: str                         # 节点唯一ID
    label: str                      # 节点显示名称
    type: str = "taskNode"          # 节点类型，用于前端渲染不同组件
    fields: List[NodeField] = field(default_factory=list)  # 节点的字段列表
    pre_node: Optional[str] = None  # 前一个节点ID
    status: str = "pending"         # 节点状态，pending(待处理), running(进行中), reviewing(待审核), reviewed(已审核通过), revising(修订中), done(已完成), error(异常)
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "type": self.type,
            "pre_node": self.pre_node,
            "fields": [f.to_dict() for f in self.fields],
            "status": self.status,
        }

# ========== 使用示例 ==========
if __name__ == "__main__":
    # 创建节点
    node1 = FlowNode(
        id="node-1",
        type="taskNode",
        label="资源分析",
        fields=[
            NodeField(key="name", value="分析任务A", field_type="text", label="任务名称"),
            NodeField(key="timeout", value=3600, field_type="number", label="超时时间"),
            NodeField(
                key="priority",
                value="high",
                field_type="select",
                label="优先级",
                choices=[
                    FieldChoice(label="低", value="low"),
                    FieldChoice(label="中", value="medium"),
                    FieldChoice(label="高", value="high"),
                ]
            ),
        ]
    )
    
    node2 = FlowNode(
        id="node-2",
        type="taskNode",
        label="资源审核",
        fields=[
            NodeField(key="reviewer", value="", field_type="text", label="审核人", required=True),
            NodeField(
                key="status",
                value="pending",
                field_type="select",
                label="状态",
                choices=[
                    FieldChoice(label="待审核", value="pending"),
                    FieldChoice(label="已通过", value="approved"),
                    FieldChoice(label="已拒绝", value="rejected"),
                ]
            ),
        ]
    )
    
    # 使用表格类型字段的示例
    node3 = FlowNode(
        id="node-3",
        type="taskNode",
        label="资源统计",
        fields=[
            NodeField(
                key="resource_table",
                value=TableValue(
                    headers=["资源名称", "数量", "状态"],
                    rows=[
                        ["CPU", "8核", "正常"],
                        ["内存", "16GB", "正常"],
                        ["磁盘", "500GB", "警告"],
                    ]
                ),
                field_type="table",
                label="资源清单"
            ),
        ]
    )
    
    # 使用超链接类型字段的示例
    node4 = FlowNode(
        id="node-4",
        type="taskNode",
        label="相关链接",
        fields=[
            NodeField(
                key="doc_url",
                value="https://example.com/docs",
                field_type="link",
                label="查看文档"  # label 作为按钮显示文本
            ),
            NodeField(
                key="repo_url",
                value="https://github.com/example/repo",
                field_type="link",
                label="代码仓库"
            ),
        ]
    )
