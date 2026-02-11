import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
import { Seat } from './seat.entity';

@Entity('sales')
export class Sale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  seatId: string;

  @Column()
  userId: string;

  @Column({ type: 'uuid' })
  reservationId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'timestamp' })
  paidAt: Date;

  @ManyToOne(() => Seat, (seat) => seat.sales, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seatId' })
  seat: Seat;

  @CreateDateColumn()
  createdAt: Date;
}
