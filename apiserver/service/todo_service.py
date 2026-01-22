#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
待办事项业务逻辑层
"""

from typing import List, Dict, Any

from dao import todo_dao


class TodoNotFoundException(Exception):
    """待办事项不存在异常"""
    pass


class TodoValidationException(Exception):
    """待办事项验证异常"""
    pass


def create_todo(user_id: int, content: str) -> Dict[str, Any]:
    """创建待办事项"""
    if not content or not content.strip():
        raise TodoValidationException("待办内容不能为空")

    todo = todo_dao.create_todo(user_id, content.strip())
    return todo.to_dict()


def get_todos(user_id: int) -> List[Dict[str, Any]]:
    """获取用户所有待办事项"""
    todos = todo_dao.get_todos_by_user(user_id)
    return [todo.to_dict() for todo in todos]


def update_todo(todo_id: int, user_id: int, content: str = None, completed: bool = None) -> Dict[str, Any]:
    """更新待办事项"""
    if content is not None and not content.strip():
        raise TodoValidationException("待办内容不能为空")

    todo = todo_dao.update_todo(todo_id, user_id, content=content.strip() if content else None, completed=completed)
    if not todo:
        raise TodoNotFoundException("待办事项不存在")
    return todo.to_dict()


def delete_todo(todo_id: int, user_id: int) -> Dict[str, Any]:
    """删除待办事项"""
    success = todo_dao.delete_todo(todo_id, user_id)
    if not success:
        raise TodoNotFoundException("待办事项不存在")
    return {"success": True}
