#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
客户端心跳记录数据访问对象
"""

from datetime import datetime, timedelta
from typing import Optional, Tuple

from .connection import get_db_session
from .models import ClientHeartbeat


def update_heartbeat(
    user_id: int,
    client_id: int,
    instance_uuid: str,
    instance_change_cooldown_seconds: int = 60
) -> Tuple[bool, str]:
    """
    更新心跳记录（带实例UUID变更检测）

    Args:
        user_id: 用户ID
        client_id: 客户端ID
        instance_uuid: 客户端实例UUID
        instance_change_cooldown_seconds: 实例变更冷却时间（秒），默认60秒

    Returns:
        (是否成功, 错误信息)
        - 成功: (True, "")
        - 实例变更冷却中: (False, "客户端实例变更，请等待N秒后再重试客户端")
    """
    with get_db_session() as session:
        heartbeat = session.query(ClientHeartbeat).filter(
            ClientHeartbeat.user_id == user_id,
            ClientHeartbeat.client_id == client_id
        ).first()

        now = datetime.now()

        if not heartbeat:
            # 首次心跳，创建记录
            heartbeat = ClientHeartbeat(
                user_id=user_id,
                client_id=client_id,
                instance_uuid=instance_uuid,
                last_sync_at=now
            )
            session.add(heartbeat)
            return True, ""

        # UUID相同，直接更新时间
        if heartbeat.instance_uuid == instance_uuid:
            heartbeat.last_sync_at = now
            return True, ""

        # UUID不同，检查冷却时间
        time_since_last = (now - heartbeat.last_sync_at).total_seconds()

        if time_since_last >= instance_change_cooldown_seconds:
            # 超过冷却时间，允许新实例接管
            heartbeat.instance_uuid = instance_uuid
            heartbeat.last_sync_at = now
            return True, ""
        else:
            # 冷却中，拒绝
            remaining = int(instance_change_cooldown_seconds - time_since_last)
            return False, f"客户端实例变更，请等待{remaining}秒后再重试客户端"


def get_heartbeat(user_id: int, client_id: int) -> Optional[ClientHeartbeat]:
    """
    获取心跳记录

    Args:
        user_id: 用户ID
        client_id: 客户端ID

    Returns:
        ClientHeartbeat对象或None
    """
    with get_db_session() as session:
        return session.query(ClientHeartbeat).filter(
            ClientHeartbeat.user_id == user_id,
            ClientHeartbeat.client_id == client_id
        ).first()


def get_latest_instance_uuid(user_id: int, client_id: int) -> Optional[str]:
    """
    获取最新的实例UUID

    Args:
        user_id: 用户ID
        client_id: 客户端ID

    Returns:
        实例UUID或None
    """
    with get_db_session() as session:
        heartbeat = session.query(ClientHeartbeat).filter(
            ClientHeartbeat.user_id == user_id,
            ClientHeartbeat.client_id == client_id
        ).first()
        return heartbeat.instance_uuid if heartbeat else None


def check_instance_uuid_valid(user_id: int, client_id: int, instance_uuid: str, cooldown_seconds: int = 60) -> bool:
    """
    检查实例UUID是否有效

    只有当实例UUID不同且最新同步时间在cooldown_seconds内才返回False

    Args:
        user_id: 用户ID
        client_id: 客户端ID
        instance_uuid: 要检查的实例UUID
        cooldown_seconds: 冷却时间（秒），默认60秒

    Returns:
        是否有效
    """
    with get_db_session() as session:
        heartbeat = session.query(ClientHeartbeat).filter(
            ClientHeartbeat.user_id == user_id,
            ClientHeartbeat.client_id == client_id
        ).first()

        if heartbeat is None:
            # 没有记录，允许
            return True

        if heartbeat.instance_uuid == instance_uuid:
            # UUID一致，允许
            return True

        # UUID不一致，检查最新同步时间是否在冷却时间内
        if heartbeat.last_sync_at:
            time_diff = datetime.now() - heartbeat.last_sync_at
            if time_diff < timedelta(seconds=cooldown_seconds):
                # 在冷却时间内，不允许
                return False

        # 超过冷却时间或没有心跳时间记录，允许
        return True


def get_heartbeats_by_user(user_id: int) -> list:
    """
    获取用户所有客户端的心跳记录

    Args:
        user_id: 用户ID

    Returns:
        心跳记录列表
    """
    with get_db_session() as session:
        heartbeats = session.query(ClientHeartbeat).filter(
            ClientHeartbeat.user_id == user_id
        ).all()
        return [hb.to_dict() for hb in heartbeats]
